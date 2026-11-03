"""Runpod queue handler. No public HTTP server, R2 credentials or database access."""
import hashlib, json, os, pathlib, re, select, subprocess, tempfile, threading, time
import urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
CACHE = pathlib.Path(os.environ.get('MANA_OCR_CACHE', '/tmp/mana-precision-cache'))
MAX_BYTES, MAX_CACHE = 512*1024*1024, 1024*1024*1024
LOCK = threading.Lock()
NODE = None

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Object redirects are not permitted')

def validate(value):
    if not isinstance(value, dict) or len(json.dumps(value).encode()) > 16000:
        raise ValueError('Invalid input')
    url = urllib.parse.urlsplit(value.get('url', ''))
    account = os.environ.get('MANA_R2_ACCOUNT', '')
    if not re.fullmatch(r'[a-f0-9]{32}', account):
        raise ValueError('Configure the allowed R2 account')
    if url.scheme != 'https' or url.netloc != account+'.r2.cloudflarestorage.com' or not url.path or url.fragment:
        raise ValueError('Invalid object endpoint')
    query = urllib.parse.parse_qs(url.query)
    try:
        expiry = int(query.get('X-Amz-Expires', ['0'])[0])
    except (ValueError, TypeError):
        raise ValueError('Invalid signed URL expiry')
    if not query.get('X-Amz-Signature') or not 1 <= expiry <= 300:
        raise ValueError('A short-lived signed object URL is required')
    if not re.fullmatch(r'[a-f0-9]{64}', value.get('documentId', '')):
        raise ValueError('Invalid document ID')
    if type(value.get('page')) is not int or not 0 <= value['page'] <= 100000:
        raise ValueError('Invalid page')
    if type(value.get('maxBytes')) is not int or not 1 <= value['maxBytes'] <= MAX_BYTES:
        raise ValueError('Invalid object size')
    etag = value.get('etag')
    if not isinstance(etag, str) or not 1 <= len(etag) <= 300 or any(ord(c) < 32 or ord(c) == 127 for c in etag):
        raise ValueError('Invalid object version')
    if value.get('direction', 'vertical') not in ['vertical', 'horizontal']:
        raise ValueError('Invalid reading direction')
    return url

def get_document(value):
    url = validate(value)
    CACHE.mkdir(mode=0o700, parents=True, exist_ok=True)
    provenance = {'origin': url.netloc, 'path': url.path, 'etag': value['etag'], 'bytes': value['maxBytes']}
    target, marker = CACHE/(value['documentId']+'.pdf'), CACHE/(value['documentId']+'.json')
    if target.exists() and marker.exists():
        if target.is_symlink() or marker.is_symlink() or json.loads(marker.read_text()) != provenance or target.stat().st_size != value['maxBytes']:
            raise ValueError('Cached document provenance mismatch')
        target.touch()
        return target
    files = sorted(CACHE.glob('*.pdf'), key=lambda file: file.stat().st_mtime)
    total = sum(file.stat().st_size for file in files)
    for file in files:
        if total+value['maxBytes'] > MAX_CACHE or time.time()-file.stat().st_mtime > 3600:
            total -= file.stat().st_size
            file.unlink(missing_ok=True)
            file.with_suffix('.json').unlink(missing_ok=True)
    temporary = target.with_suffix('.partial')
    request = urllib.request.Request(value['url'], headers={'If-Match': value['etag'], 'Accept-Encoding': 'identity'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response, temporary.open('xb') as output:
            if response.headers.get('ETag') != value['etag']:
                raise ValueError('Object version changed')
            length = response.headers.get('Content-Length')
            if length is not None and int(length) != value['maxBytes']:
                raise ValueError('Object length changed')
            size, deadline = 0, time.monotonic()+60
            while chunk := response.read(1024*1024):
                size += len(chunk)
                if size > value['maxBytes'] or time.monotonic() > deadline:
                    raise ValueError('Object download exceeded bounds')
                output.write(chunk)
            if size != value['maxBytes']:
                raise ValueError('Object download incomplete')
        temporary.replace(target)
        marker.write_text(json.dumps(provenance))
        return target
    finally:
        temporary.unlink(missing_ok=True)

def command(args, timeout=30, max_output=1000000):
    with tempfile.TemporaryFile() as output:
        subprocess.run(args, check=True, stdout=output, stderr=subprocess.DEVNULL, timeout=timeout)
        if output.tell() > max_output:
            raise ValueError('Document output exceeds bounds')
        output.seek(0)
        return output.read()

def stop_node():
    global NODE
    if NODE is not None:
        NODE.terminate()
        try:
            NODE.wait(timeout=5)
        except subprocess.TimeoutExpired:
            NODE.kill()
            NODE.wait()
        for stream in [NODE.stdin, NODE.stdout]:
            stream.close()
        NODE = None

def precision_page(image, direction):
    global NODE
    workers = int(os.environ.get('MANA_OCR_WORKERS', '4'))
    if not 1 <= workers <= 4:
        raise ValueError('Invalid parallelism')
    if NODE is None or NODE.poll() is not None:
        stop_node()
        NODE = subprocess.Popen(['node', '--max-old-space-size=2048', str(ROOT/'runner.mjs')], cwd=ROOT,
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
    try:
        data = json.dumps({'image': str(image), 'direction': direction, 'workers': workers, 'timeoutMs': 480000}).encode()+b'\n'
        NODE.stdin.write(data)
        NODE.stdin.flush()
        deadline, chunks = time.monotonic()+490, bytearray()
        while True:
            remaining = deadline-time.monotonic()
            if remaining <= 0 or not select.select([NODE.stdout], [], [], remaining)[0]:
                raise TimeoutError('Precision page deadline exceeded')
            part = os.read(NODE.stdout.fileno(), 65536)
            if not part or len(chunks)+len(part) > 800000:
                raise ValueError('Invalid precision response')
            chunks.extend(part)
            if b'\n' in part:
                break
        message = json.loads(chunks)
        if message.get('ok') is not True:
            raise ValueError('Page requires retry or manual review')
        result = message['result']
        if result.get('engine') != 'manga-ocr-q8' or not isinstance(result.get('text'), str) or not result['text'].strip():
            raise ValueError('Invalid precision result')
        return result
    except Exception:
        stop_node()
        raise

def recognize(value):
    document = get_document(value)
    info = command(['pdfinfo', str(document)]).decode('utf-8', 'replace')
    pages = re.search(r'^Pages:\s+(\d+)', info, re.M)
    if not pages or not 1 <= int(pages[1]) <= 100000 or value['page'] > int(pages[1]):
        raise ValueError('Invalid PDF page count')
    title = re.search(r'^Title:\s*(.*)', info, re.M)
    result = {'documentId': value['documentId'], 'pageCount': int(pages[1]), 'title': title[1][:250] if title else ''}
    if value['page'] == 0:
        return result
    page = str(value['page'])
    # Native text PDFs retain their original text layer. Scanned pages always
    # use the precision engine; no Tesseract/low-quality fallback is installed.
    text = command(['pdftotext', '-f', page, '-l', page, '-layout', str(document), '-'], max_output=600000).decode('utf-8', 'replace').strip()
    if value.get('forceOCR') is not True and len(re.sub(r'\s', '', text)) >= 15:
        return {**result, 'page': value['page'], 'text': text, 'method': 'text', 'blocks': [], 'confidence': None}
    with tempfile.TemporaryDirectory(prefix='mana-precision-page-') as temporary:
        prefix = pathlib.Path(temporary)/'page'
        command(['pdftoppm', '-f', page, '-l', page, '-singlefile', '-scale-to', '2200', '-png', str(document), str(prefix)])
        recognized = precision_page(prefix.with_suffix('.png'), value.get('direction', 'vertical'))
        return {**result, 'page': value['page'], **recognized}

def handler(job):
    # Runpod handles authentication and the durable queue. One page per job;
    # four internal lanes share weights. No secrets or document URLs are logged.
    with LOCK:
        try:
            return recognize(job['input'])
        except Exception:
            # Never return library diagnostics, paths, signed URLs or OCR fragments.
            return {'error': 'Precision page unavailable; retry with a fresh signed URL or review the page'}

if __name__ == '__main__':
    import runpod
    if not re.fullmatch(r'[a-f0-9]{32}', os.environ.get('MANA_R2_ACCOUNT', '')):
        raise SystemExit('Set MANA_R2_ACCOUNT before starting the worker')
    runpod.serverless.start({'handler': handler})
