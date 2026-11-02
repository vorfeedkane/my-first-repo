"""Download only the pinned public model; Docker builds verify every byte."""
import hashlib, json, pathlib, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
REVISION = '8e15f1319f1ed70b9560a39f42340dd19ee49f92'
REPO = 'kimchireader/manga-ocr-onnx-q8'
FILES = ['config.json', 'preprocessor_config.json', 'tokenizer_config.json',
         'tokenizer.json', 'special_tokens_map.json', 'generation_config.json',
         'onnx/encoder_model_quantized.onnx']

def main():
    creating = sys.argv[1:] == ['--write-lock']
    if sys.argv[1:] and not creating:
        raise SystemExit('Only --write-lock is accepted for maintainer initialization')
    lockfile = ROOT / 'models-lock.json'
    lock = None if creating else json.loads(lockfile.read_text())
    if lock and (lock['repository'] != REPO or lock['revision'] != REVISION):
        raise ValueError('Model revision mismatch')
    out = ROOT / 'models/base'
    out.mkdir(parents=True, exist_ok=True)
    result = {}
    for name in FILES:
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        expected = lock['files'].get(name) if lock else None
        if target.exists() and expected and hashlib.sha256(target.read_bytes()).hexdigest() == expected['sha256']:
            result[name] = expected
            continue
        temporary = target.with_suffix('.partial')
        try:
            request = urllib.request.Request(f'https://huggingface.co/{REPO}/resolve/{REVISION}/{name}', headers={'Accept-Encoding': 'identity'})
            digest, size = hashlib.sha256(), 0
            with urllib.request.urlopen(request, timeout=60) as response, temporary.open('wb') as output:
                while chunk := response.read(1024*1024):
                    size += len(chunk)
                    if size > 128*1024*1024:
                        raise ValueError('Model file exceeds limit')
                    digest.update(chunk)
                    output.write(chunk)
            entry = {'bytes': size, 'sha256': digest.hexdigest()}
            if expected and entry != expected:
                raise ValueError('Pinned model hash mismatch: '+name)
            if lock and not expected:
                raise ValueError('Unpinned model file: '+name)
            temporary.replace(target)
            result[name] = entry
            print('Verified public model file:', name, size, flush=True)
        finally:
            temporary.unlink(missing_ok=True)
    if creating:
        lockfile.write_text(json.dumps({'repository': REPO, 'revision': REVISION, 'files': result}, indent=2)+'\n')

if __name__ == '__main__':
    main()
