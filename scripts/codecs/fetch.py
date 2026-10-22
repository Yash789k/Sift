"""Fetch locked source archives; keep the same files for the release source bundle."""
import concurrent.futures
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from source_integrity import verify

manifest_path = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else pathlib.Path(__file__).with_name('sources.json')
manifest = json.loads(manifest_path.read_text())
destination = pathlib.Path(sys.argv[1]).resolve()
destination.mkdir(parents=True, exist_ok=True)
group = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != 'all' else None

def fetch(item):
    target = destination / item['file']
    if not target.exists():
        temporary = target.with_suffix(target.suffix + '.part')
        subprocess.run(['curl', '--fail', '--location', '--retry', '3', '--silent', '--show-error', '--max-time', '180', item['url'], '-o', str(temporary)], check=True)
        temporary.replace(target)
    verify(target, item)
    print(f"Verified {target.name}", flush=True)

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    list(pool.map(fetch, [item for item in manifest if not group or group in item['groups']]))
