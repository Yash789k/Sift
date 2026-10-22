"""Fetch locked source archives; keep the same files for the release source bundle."""
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess
import sys

manifest = json.loads(pathlib.Path(__file__).with_name('sources.json').read_text())
destination = pathlib.Path(sys.argv[1]).resolve()
destination.mkdir(parents=True, exist_ok=True)
group = sys.argv[2] if len(sys.argv) > 2 else None

def fetch(item):
    target = destination / item['file']
    if not target.exists():
        temporary = target.with_suffix(target.suffix + '.part')
        subprocess.run(['curl', '--fail', '--location', '--retry', '3', '--silent', '--show-error', item['url'], '-o', str(temporary)], check=True)
        temporary.replace(target)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    if digest != item['sha256']:
        raise ValueError(f"Source checksum mismatch: {target.name}")
    print(f"Verified {target.name}", flush=True)

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    list(pool.map(fetch, [item for item in manifest if not group or group in item['groups']]))
