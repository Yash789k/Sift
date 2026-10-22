"""Preserve upstream copyright/license text alongside the installed application."""
import pathlib
import hashlib
import json
import re
import sys
import tarfile

source = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
index = []
for archive in sorted(source.glob('*')):
    if not tarfile.is_tarfile(archive):
        continue
    with tarfile.open(archive) as contents:
        for member in contents.getmembers():
            relative = pathlib.PurePosixPath(member.name)
            if (not member.isfile() or member.size > 2_000_000 or relative.is_absolute() or
                    '..' in relative.parts or not re.match(r'^(copying|copyright|licen[cs]e|notice|authors|third.party.notices)([.\-_]|$)', relative.name, re.I)):
                continue
            data = contents.extractfile(member).read()
            try:
                data.decode('utf8')
            except UnicodeDecodeError:
                continue
            name = hashlib.sha256((archive.name + '/' + member.name).encode()).hexdigest()[:20] + '.txt'
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            index.append({'notice': name, 'archive': archive.name, 'original_path': member.name})
destination.mkdir(parents=True, exist_ok=True)
(destination / 'index.json').write_text(json.dumps(index, indent=2) + '\n')
print('Collected upstream license and copyright files.')
