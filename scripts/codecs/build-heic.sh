#!/usr/bin/env bash
# Rebuild elheif's encoder with pinned source, instead of its opaque npm payload.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
work=${1:?Pass an absolute build directory}
mkdir -p "$work"
work=$(cd "$work" && pwd)
prefix="$work/prefix"
mkdir -p "$prefix" "$work/sources" "$work/src" "$work/result"
python3 "$root/scripts/codecs/fetch.py" "$work/sources" heic
export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
jobs=${SIFT_BUILD_JOBS:-4}
unpack() {
  mkdir -p "$work/src/$1"
  tar xf "$work/sources/$2" -C "$work/src/$1" --strip-components=1
  cd "$work/src/$1"
}
unpack kvazaar kvazaar-2.3.2.tar.gz
# Upstream CMake adds this x86-only flag even for Emscripten.
python3 - <<'PYCODE'
from pathlib import Path
p = Path('CMakeLists.txt')
p.write_text('\n'.join(line for line in p.read_text().splitlines() if '-muse-unaligned-vector-move' not in line) + '\n')
PYCODE
emcmake cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" \
  -DCMAKE_INSTALL_LIBDIR=lib -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTS=OFF \
  -DBUILD_KVAZAAR_BINARY=OFF -DUSE_CRYPTO=OFF \
  -DCMAKE_C_FLAGS=-D__EMSCRIPTEN_STANDALONE_WASM__=1
cmake --build build -j"$jobs"
cmake --install build
unpack libheif libheif-1.23.6.tar.gz
emcmake cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" \
  -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_PREFIX_PATH="$prefix" -DCMAKE_FIND_ROOT_PATH="$prefix" \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF -DBUILD_DOCUMENTATION=OFF \
  -DENABLE_PLUGIN_LOADING=OFF -DENABLE_MULTITHREADING_SUPPORT=OFF -DWITH_EXAMPLES=OFF \
  -DWITH_GDK_PIXBUF=OFF -DWITH_X265=OFF -DWITH_LIBDE265=OFF -DWITH_KVAZAAR=ON \
  -DWITH_AOM_DECODER=OFF -DWITH_AOM_ENCODER=OFF -DWITH_DAV1D=OFF \
  -DWITH_RAV1E=OFF -DWITH_SvtEnc=OFF -DWITH_JPEG_DECODER=OFF -DWITH_JPEG_ENCODER=OFF \
  -DWITH_OpenJPEG_DECODER=OFF -DWITH_OpenJPEG_ENCODER=OFF
cmake --build build -j"$jobs"
cmake --install build
unpack elheif elheif-42867c31.tar.gz
em++ -O3 -std=c++17 -Icore/include -I"$prefix/include" \
  core/src/impl.cpp wasm/src/impl.cpp -L"$prefix/lib" -lheif -lkvazaar \
  -lembind -sINITIAL_MEMORY=64MB -sEXPORT_NAME=__ELHEIF_MODULE \
  -sSINGLE_FILE=1 -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH=1 \
  -sSTACK_SIZE=1MB -o "$work/result/elheif-wasm.js"
python3 - "$work/result/elheif-wasm.js" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
p.write_text('globalThis.__init__ELHEIF_MODULE = function (__ELHEIF_MODULE) {' + p.read_text() + '};\n')
PY
cp LICENSE "$work/result/elheif-LICENSE"
cp "$work/src/libheif/COPYING" "$work/result/libheif-COPYING"
cp "$work/src/kvazaar/LICENSE" "$work/result/kvazaar-LICENSE"
emcc --version > "$work/result/emscripten-version.txt"
