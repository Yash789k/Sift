"""Verify file bytes, or archive contents when upstream varies gzip/tar timestamps."""
import hashlib
import json
import pathlib
import tarfile

def content_hash(filename):
    entries = []
    with tarfile.open(filename) as archive:
        for member in archive.getmembers():
            name = pathlib.PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts:
                raise ValueError('Unsafe source archive path')
            if member.isfile():
                data = hashlib.sha256(archive.extractfile(member).read()).hexdigest()
            elif member.issym() or member.islnk():
                data = member.linkname
            elif member.isdir():
                data = ''
            else:
                raise ValueError('Unexpected source archive entry')
            entries.append([str(name), member.type.decode('ascii'), member.mode, data])
    canonical = json.dumps(sorted(entries), separators=(',', ':'), ensure_ascii=True).encode()
    return hashlib.sha256(canonical).hexdigest()

def verify(filename, item):
    actual = hashlib.sha256(pathlib.Path(filename).read_bytes()).hexdigest()
    if item.get('contentSha256'):
        if content_hash(filename) != item['contentSha256']:
            raise ValueError(f"Source contents mismatch: {item['file']}")
    elif actual != item['sha256']:
        raise ValueError(f"Source checksum mismatch: {item['file']}")
    return actual
