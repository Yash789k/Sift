"""Create the source companion from the same commit and locked dependency archives."""
import json
import pathlib
import shutil
import subprocess
import sys
import tarfile
from source_integrity import verify

root = pathlib.Path(__file__).resolve().parent.parent
downloads = pathlib.Path(sys.argv[1]).resolve()
destination = pathlib.Path(sys.argv[2]).resolve()
provenance = pathlib.Path(sys.argv[3]).resolve()
destination.mkdir(parents=True, exist_ok=True)
version = json.loads((root / 'package.json').read_text())['version']
stage = destination / 'corresponding-source'
stage.mkdir(exist_ok=True)
archives = stage / 'upstream'
archives.mkdir(exist_ok=True)
manifest = []
for name in ['scripts/codecs/sources.json', 'scripts/native-sources.json']:
    manifest.extend(json.loads((root / name).read_text()))
for item in manifest:
    source = downloads / item['file']
    item['sha256'] = verify(source, item)
    shutil.copyfile(source, archives / source.name)
(stage / 'SOURCE-MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')
for target, names in {
    'ffmpeg-macos-arm64': ['config.h', 'config.mak', 'ffmpeg-version.txt', 'ffmpeg-license.txt'],
    'ffmpeg-windows-x64': ['config.h', 'config.mak', 'ffmpeg-version.txt', 'ffmpeg-license.txt'],
    'heic': ['emscripten-version.txt'],
}.items():
    folder = stage / 'build-configuration' / target
    folder.mkdir(parents=True, exist_ok=True)
    for name in names:
        shutil.copyfile(provenance / target / 'result' / name, folder / name)
subprocess.run(['git', 'archive', '--format=tar.gz', '-o', str(stage / 'Sift-source.tar.gz'), 'HEAD'], cwd=root, check=True)
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
(stage / 'README.txt').write_text(f'''Sift {version} corresponding source
Sift commit: {commit}

Sift-source.tar.gz contains the application, lockfile and complete release scripts.
upstream/ contains the source archives and patches listed in SOURCE-MANIFEST.json.
Archive checksums identify the precise files; read the included upstream licenses.
build-configuration/ records the actual FFmpeg configurations and compiler/SDK
version outputs from the codec builds used in this release.

To rebuild Sift, extract Sift-source.tar.gz and follow CONTRIBUTING.md and
DISTRIBUTION.md. The .github/workflows/release.yml file records the build hosts
and tool installation. scripts/codecs/build-ffmpeg.sh and build-heic.sh rebuild
the replacement codecs. Copy these upstream archives into the build directory's
sources/ folder to reuse them without downloading them again. Install release
codecs with scripts/install-release-codecs.cjs before packaging.

For libheif-js, extract libheif-emscripten-build and libheif-decoder-source,
put the latter at the former's libheif/ path, and follow its emscripten workflow
with Emscripten 3.1.61 and libde265 1.0.15. For native libvips, follow the pinned
sharp-libvips build recipe (macOS) or vips-windows-build/MXE recipe (Windows).
The matching upstream component sources, patches and librsvg's Cargo.lock
dependencies are supplied here. Preserve upstream configuration/patches.

Canvas/Skia is permissively licensed. Its source/notice collection is supplied
for attribution. Upstream canvas does not publish a Rust lockfile for its npm
binary; canvas-notices-* archives are supplemental license material, not a
claim that those are the exact resolved Rust versions used in its binary.

Recipients may modify and rebuild Sift and the GPL/LGPL components. No private
signing key is needed for unsigned Windows or ad-hoc Mac builds. Packaged
resources are unpacked files. A modified Mac bundle may need a new ad-hoc
signature (codesign --force --deep --sign - Sift.app).

Build tools and operating-system SDKs are obtained separately by the workflow.
No user data, credentials or developer-specific profiles are included.
''')
output = destination / f'Sift-{version}-corresponding-source.tar.gz'
with tarfile.open(output, 'w:gz', compresslevel=4) as archive:
    archive.add(stage, arcname=f'Sift-{version}-source')
print(output.name)
