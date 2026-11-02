"""Build the exact q8 decoder's image-invariant cache, without retraining.

Requires onnx. The input must be the pinned, SHA-256 verified decoder. Run:
python scripts/build-precision-cache.py /path/decoder_model_merged_quantized.onnx
No checkpoint or network credentials are needed; original weights are unchanged.
"""
from pathlib import Path
import argparse
import hashlib
import json
import onnx
from onnx import shape_inference, external_data_helper
from onnx.utils import Extractor

SOURCE_SHA = '31fabafa8ced08010d8c4851880afe1d8c062284606ea8ef3eb779637f022dd9'
REVISION = '8e15f1319f1ed70b9560a39f42340dd19ee49f92'


def build(source, destination):
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != SOURCE_SHA:
        raise ValueError('Input does not match the pinned q8 decoder.')
    model = shape_inference.infer_shapes(onnx.load_model_from_string(data))
    assert [v.name for v in model.graph.input] == ['input_ids', 'encoder_hidden_states']
    dependencies = {'input_ids': 1, 'encoder_hidden_states': 2}
    users = {}
    for node in model.graph.node:
        mask = 0
        for value in node.input:
            mask |= dependencies.get(value, 0)
            users.setdefault(value, []).append(node)
        for value in node.output:
            dependencies[value] = mask
    # Cut only edges whose ancestors are constants and encoder_hidden_states.
    # Dynamic quantization over text prefixes stays in the original decoder.
    frontier = [value for node in model.graph.node for value in node.output
                if dependencies[value] == 2 and any(
                    any(dependencies.get(output, 0) == 3 for output in user.output)
                    for user in users.get(value, []))]
    assert len(frontier) == 7, 'Unexpected pinned-model graph.'
    cache = Extractor(model).extract_model(['encoder_hidden_states'], frontier)
    decoder = Extractor(model).extract_model(['input_ids'] + frontier, ['logits'])
    aliases = {value: 'vision_' + str(i) for i, value in enumerate(frontier)}
    blobs = {}
    for name, part in [('vision_cache_quantized.onnx', cache), ('decoder_quantized.onnx', decoder)]:
        for node in part.graph.node:
            for values in [node.input, node.output]:
                for i, value in enumerate(values):
                    if value in aliases:
                        values[i] = aliases[value]
        for value in list(part.graph.input) + list(part.graph.output) + list(part.graph.value_info):
            if value.name in aliases:
                value.name = aliases[value.name]
        onnx.checker.check_model(part)
        if name == 'decoder_quantized.onnx':
            # Workers assets are capped at 25 MiB. Keep each immutable weight
            # shard <=16 MiB; the runtime loads these two external-data files.
            shards = [bytearray()]
            for tensor in part.graph.initializer:
                if len(tensor.raw_data) < 1024:
                    continue
                if len(shards[-1]) + len(tensor.raw_data) > 16 * 1024 * 1024:
                    shards.append(bytearray())
                index = len(shards) - 1
                location = name + '_data' + ('_' + str(index) if index else '')
                offset, length = len(shards[-1]), len(tensor.raw_data)
                shards[-1].extend(tensor.raw_data)
                external_data_helper.set_external_data(tensor, location=location, offset=offset, length=length)
                tensor.ClearField('raw_data')
            assert len(shards) == 2
            for index, shard in enumerate(shards):
                blobs[name + '_data' + ('_' + str(index) if index else '')] = bytes(shard)
        blobs[name] = part.SerializeToString()
    fingerprint = hashlib.sha256(b''.join(blobs.values())).hexdigest()[:16]
    directory = 'decoder-cache.' + fingerprint
    out = destination / directory / 'onnx'
    out.mkdir(parents=True, exist_ok=True)
    for name, blob in blobs.items():
        (out / name).write_bytes(blob)
    manifest = {
        'format': 1, 'directory': directory,
        'source': {'repository': 'kimchireader/manga-ocr-onnx-q8', 'revision': REVISION, 'decoderSHA256': SOURCE_SHA},
        'files': {name: {'bytes': len(blob), 'sha256': hashlib.sha256(blob).hexdigest()} for name, blob in blobs.items()},
        'cacheNames': list(aliases.values()),
        'decoderExternalDataChunks': 2,
        'nodes': {'original': len(model.graph.node), 'cache': len(cache.graph.node), 'decoder': len(decoder.graph.node)},
    }
    (destination / directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--destination', type=Path, default=Path('public/vendor/precision'))
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.destination), indent=2))
