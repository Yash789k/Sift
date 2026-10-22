#!/usr/bin/env bash
# Build only from archives checked by fetch.py. No nonfree or downloaded binaries.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
work=${1:?Pass an absolute build directory outside a synced folder}
mkdir -p "$work"
work=$(cd "$work" && pwd)
prefix="$work/prefix"
mkdir -p "$prefix" "$work/sources" "$work/src" "$work/result"
python3 "$root/scripts/codecs/fetch.py" "$work/sources" ffmpeg
export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
export CFLAGS="-O2 -fPIC"
export CPPFLAGS="-I$prefix/include"
export LDFLAGS="-L$prefix/lib"
export CXXFLAGS="$CFLAGS"
jobs=${SIFT_BUILD_JOBS:-4}
extra=()
vpx_target=()
case $(uname -s) in
  Darwin) export MACOSX_DEPLOYMENT_TARGET=13.0 ;;
  MINGW*|MSYS*)
    export CC=gcc CXX=g++
    export LDFLAGS="$LDFLAGS -static"
    extra+=(--target-os=mingw32 --extra-libs=-lpthread)
    vpx_target+=(--target=x86_64-win64-gcc)
    ;;
  *) echo 'Build release FFmpeg on macOS or MSYS2/Windows.' >&2; exit 1 ;;
esac
unpack() {
  mkdir -p "$work/src/$1"
  tar xf "$work/sources/$2" -C "$work/src/$1" --strip-components=1
  cd "$work/src/$1"
}
unpack ogg libogg-1.3.5.tar.gz
./configure --prefix="$prefix" --disable-shared --enable-static
make -j"$jobs" && make install
unpack vorbis libvorbis-1.3.7.tar.gz
./configure --prefix="$prefix" --disable-shared --enable-static --disable-oggtest
make -j"$jobs" && make install
unpack lame lame-3.100.tar.gz
./configure --prefix="$prefix" --disable-shared --enable-static --disable-frontend --disable-nasm
make -j"$jobs" && make install
unpack opus opus-1.6.1.tar.gz
./configure --prefix="$prefix" --disable-shared --enable-static --disable-extra-programs --disable-doc
make -j"$jobs" && make install
unpack x264 x264-31e19f92.tar.gz
./configure --prefix="$prefix" --enable-static --enable-pic --disable-cli --disable-opencl
make -j"$jobs" && make install
unpack vpx libvpx-1.17.0.tar.gz
./configure --prefix="$prefix" --enable-pic --disable-shared --disable-examples --disable-tools --disable-docs --disable-unit-tests "${vpx_target[@]}"
make -j"$jobs" && make install
unpack ffmpeg ffmpeg-8.1.3.tar.xz
./configure --prefix="$prefix" --disable-autodetect --disable-shared --enable-static \
  --disable-doc --disable-debug --disable-network --disable-ffplay --disable-ffprobe \
  --enable-gpl --enable-version3 --enable-libx264 --enable-libvpx --enable-libmp3lame \
  --enable-libopus --enable-libvorbis --pkg-config-flags=--static \
  --extra-cflags="-I$prefix/include" --extra-ldflags="$LDFLAGS" "${extra[@]}"
make -j"$jobs"
binary=ffmpeg
[[ -f ffmpeg.exe ]] && binary=ffmpeg.exe
cp "$binary" "$work/result/$binary"
"$work/result/$binary" -version > "$work/result/ffmpeg-version.txt"
"$work/result/$binary" -L > "$work/result/ffmpeg-license.txt" 2>&1
if grep -q -- '--enable-nonfree' "$work/result/ffmpeg-version.txt"; then exit 1; fi
cp ffbuild/config.mak config.h "$work/result/"
cp COPYING* LICENSE.md "$work/result/"
printf 'Built %s\n' "$work/result/$binary"
