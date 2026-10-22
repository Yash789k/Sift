"""Publish only a successful installer run into its existing draft prerelease."""
import argparse
import base64
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tarfile


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)


def api(path):
    return json.loads(gh('api', path))


def digest(stream):
    result = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        result.update(chunk)
    return result.hexdigest()


def check(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run_id')
    parser.add_argument('artifacts', type=pathlib.Path)
    parser.add_argument('--check-only', action='store_true', help='Validate locally without uploading or publishing')
    args = parser.parse_args()
    repo = os.environ['GH_REPO']
    check(bool(re.fullmatch(r'[0-9]+', args.run_id)), 'Use a numeric workflow run ID')
    run = api(f'repos/{repo}/actions/runs/{args.run_id}')
    check(run['repository']['full_name'] == repo and run['head_repository']['full_name'] == repo,
          'The build must come from this repository')
    check(run['path'] == '.github/workflows/release.yml' and run['event'] in ('push', 'workflow_dispatch'),
          'Select a trusted Build installers run')
    check(run['status'] == 'completed' and run['conclusion'] == 'success', 'The entire build must pass first')
    commit = run['head_sha']
    package = api(f'repos/{repo}/contents/package.json?ref={commit}')
    version = json.loads(base64.b64decode(package['content']))['version']
    check(bool(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?', version)), 'Invalid release version')
    tag = f'v{version}'
    releases = api(f'repos/{repo}/releases?per_page=100')
    release = next((item for item in releases if item['tag_name'] == tag), None)
    check(release is not None and release['draft'] and release['prerelease'], 'Prepare a draft prerelease first')
    check(release['target_commitish'] == commit, 'Draft target must be the exact tested commit SHA')
    check(bool(release['body'].strip()), 'Write release notes before publishing')
    filenames = [f'Sift-{version}-macos-arm64.dmg', f'Sift-{version}-windows-x64-setup.exe',
                 f'Sift-{version}-corresponding-source.tar.gz']
    files = []
    for filename in filenames:
        matches = list(args.artifacts.rglob(filename))
        check(len(matches) == 1 and matches[0].is_file() and matches[0].stat().st_size > 0,
              f'Expected exactly one nonempty {filename}')
        files.append(matches[0])

    manifest, readme, source_hash, hashes = None, None, None, {}
    with tarfile.open(files[2], 'r|gz') as archive:
        for member in archive:
            if not member.isfile():
                continue
            stream = archive.extractfile(member)
            leaf = pathlib.PurePosixPath(member.name).name
            if leaf == 'SOURCE-MANIFEST.json':
                manifest = json.load(stream)
            elif member.name.endswith('/README.txt') and member.name.count('/') == 1:
                readme = stream.read().decode()
            elif leaf == 'Sift-source.tar.gz':
                source_hash = digest(stream)
            elif '/upstream/' in member.name:
                check(leaf not in hashes, f'Duplicate source archive: {leaf}')
                hashes[leaf] = digest(stream)
    check(manifest and readme and f'Sift commit: {commit}' in readme, 'Source provenance does not match the build')
    check(len(hashes) == len(manifest), 'Source archive inventory differs from its manifest')
    for item in manifest:
        check(hashes.get(item['file']) == item['sha256'], f'Source checksum mismatch: {item["file"]}')
    expected_source = subprocess.check_output(['git', 'archive', '--format=tar.gz', commit])
    check(hashlib.sha256(expected_source).hexdigest() == source_hash, 'Application source differs from the tested commit')

    checksums = {}
    for file in files:
        with file.open('rb') as stream:
            checksums[file.name] = digest(stream)
    checksum_file = args.artifacts / 'SHA256SUMS.txt'
    checksum_file.write_text(''.join(f'{value}  {name}\n' for name, value in checksums.items()))
    files.append(checksum_file)
    with checksum_file.open('rb') as stream:
        checksums[checksum_file.name] = digest(stream)
    print(json.dumps({'tag': tag, 'commit': commit, 'verifiedUpstreamArchives': len(hashes), 'sha256': checksums}), flush=True)
    if args.check_only:
        return

    existing = {asset['name']: asset for asset in release['assets']}
    check(set(existing) <= set(checksums), 'The draft contains unexpected assets')
    for file in files:
        asset = existing.get(file.name)
        if asset:
            check(asset['state'] == 'uploaded' and asset['digest'] == f'sha256:{checksums[file.name]}'
                  and asset['size'] == file.stat().st_size, f'Existing asset differs: {file.name}')
        else:
            subprocess.run(['gh', 'release', 'upload', tag, str(file)], check=True)
    uploaded = api(f'repos/{repo}/releases/{release["id"]}')
    actual = {asset['name']: asset for asset in uploaded['assets']}
    check(set(actual) == set(checksums), 'Release asset inventory is incomplete')
    for file in files:
        asset = actual[file.name]
        check(asset['state'] == 'uploaded' and asset['digest'] == f'sha256:{checksums[file.name]}'
              and asset['size'] == file.stat().st_size, f'Remote digest mismatch: {file.name}')
    subprocess.run(['gh', 'release', 'edit', tag, '--draft=false', '--prerelease', '--latest=false'], check=True)
    print(f'Published https://github.com/{repo}/releases/tag/{tag}')


if __name__ == '__main__':
    main()
