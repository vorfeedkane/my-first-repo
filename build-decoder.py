"""Rebuild Mana's immutable decoder partition from the pinned public source."""
import hashlib, importlib.util, json, pathlib, shutil, tempfile, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent

def main():
    expected = json.loads((ROOT/'models/cache/manifest.json').read_text())
    spec = importlib.util.spec_from_file_location('mana_decoder_builder', ROOT/'build-precision-cache.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with tempfile.TemporaryDirectory(prefix='mana-model-build-') as directory:
        directory = pathlib.Path(directory)
        source = directory/'decoder.onnx'
        repository = expected['source']['repository']
        revision = expected['source']['revision']
        url = f'https://huggingface.co/{repository}/resolve/{revision}/onnx/decoder_model_merged_quantized.onnx'
        digest, size = hashlib.sha256(), 0
        request = urllib.request.Request(url, headers={'Accept-Encoding':'identity'})
        with urllib.request.urlopen(request, timeout=60) as response, source.open('wb') as output:
            while chunk := response.read(1024*1024):
                size += len(chunk)
                if size > 64*1024*1024:
                    raise ValueError('Public decoder exceeds build limit')
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != expected['source']['decoderSHA256']:
            raise ValueError('Original decoder SHA mismatch')
        actual = module.build(source, directory/'partition')
        for field in ['directory','source','files','cacheNames','decoderExternalDataChunks','nodes']:
            if actual[field] != expected[field]:
                raise ValueError('Generated partition differs from accepted model: '+field)
        src = directory/'partition'/actual['directory']/'onnx'
        dest = ROOT/'models/cache/onnx'
        dest.mkdir(parents=True, exist_ok=True)
        for name, record in expected['files'].items():
            file = src/name
            if hashlib.sha256(file.read_bytes()).hexdigest() != record['sha256']:
                raise ValueError('Generated model SHA mismatch')
            shutil.copyfile(file, dest/name)
        print('Pinned image-only decoder partition reproduced byte-for-byte.')

if __name__ == '__main__':
    main()
