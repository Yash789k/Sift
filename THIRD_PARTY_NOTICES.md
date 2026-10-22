# Third-party notices

Sift's original source and project-created assets are licensed GPL-3.0-or-later; see LICENSE. Third-party components retain their own copyright and license terms. Installed metadata was inspected for the versions below. Preserve each component's bundled license and notice files.

| Component | Version | Declared license | Upstream |
|---|---|---|---|
| Electron | 44.9.1 | MIT; bundled components have additional notices | [electron/electron](https://github.com/electron/electron) |
| sharp | 0.35.5 | Apache-2.0; native dependencies have additional licenses | [lovell/sharp](https://github.com/lovell/sharp) |
| pdf-lib | 1.17.1 | MIT | [Hopding/pdf-lib](https://github.com/Hopding/pdf-lib) |
| pdfjs-dist | 4.10.38 | Apache-2.0 | [mozilla/pdf.js](https://github.com/mozilla/pdf.js) |
| @napi-rs/canvas | 0.1.100 | MIT; includes native dependencies | [Brooooooklyn/canvas](https://github.com/Brooooooklyn/canvas) |
| docx | 9.13.0 | MIT | [dolanmiu/docx](https://github.com/dolanmiu/docx) |
| exifr | 7.1.3 | MIT | [MikeKovarik/exifr](https://github.com/MikeKovarik/exifr) |
| bmp-js | 0.1.0 | MIT | [shaozilee/bmp-js](https://github.com/shaozilee/bmp-js) |
| heic-decode | 2.1.0 | ISC | [catdad-experiments/heic-decode](https://github.com/catdad-experiments/heic-decode) |
| libheif-js (transitive) | 1.23.5 | LGPL-3.0 | [catdad-experiments/libheif-js](https://github.com/catdad-experiments/libheif-js) |
| elheif | 0.1.0 | MIT wrapper; embedded libraries retain their licenses | [hpp2334/elheif](https://github.com/hpp2334/elheif) |
| libheif in release encoder WASM | 1.23.6 | LGPLv3 library; see upstream notice | [libheif COPYING](https://github.com/strukturag/libheif/blob/master/COPYING) |
| libde265 in libheif-js decoder | 1.0.15 | LGPLv3 library; see upstream notice | [libde265 COPYING](https://github.com/strukturag/libde265/blob/master/COPYING) |
| kvazaar in release encoder WASM | 2.3.2 | BSD-3-Clause | [kvazaar LICENSE](https://github.com/ultravideo/kvazaar/blob/master/LICENSE) |
| Koffi | 2.14.1 | MIT | [Koromix/koffi](https://github.com/Koromix/koffi) |
| ffmpeg-static | 5.3.0 | GPL-3.0-or-later | [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) |
| electron-builder (build tool) | 26.15.3 | MIT; downloaded packaging/signing tools have their own notices | [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) |

Release builds replace the npm FFmpeg executable with **FFmpeg 8.1.3**, configured under GPL-3.0-or-later and without nonfree components. Its external codecs are x264 (GPL), libvpx (BSD), LAME (LGPL), Opus (BSD), libvorbis (BSD) and libogg (BSD). Exact source URLs, checksums, build scripts and full license texts accompany the release. The old Mac npm payload uses `--enable-nonfree` and must not be redistributed.

Release builds also replace elheif's unpinned npm WASM with a build from pinned elheif source, libheif 1.23.6 and kvazaar 2.3.2. elheif's MIT wrapper does not change libheif's LGPL obligations. The separate libheif-js decoder uses libheif 1.23.5 and libde265 1.0.15. See [DISTRIBUTION.md](DISTRIBUTION.md) for exact revisions and rebuild instructions.

The installed `licenses` folder contains upstream license/copyright text and production package metadata, including notices for Sharp/libvips and canvas/Skia dependencies. Electron's own license and Chromium credits remain in the app. The release's corresponding-source archive includes source and patches for the covered native components; it is available beside the installer in [Releases](https://github.com/Yash789k/Sift/releases).

The Sift icon and Aurora sample illustration were created for this project. [Tangerine for Mac](https://www.tangerineformac.com/) is the user's visual and interaction reference; Sift is an independent implementation with original code and assets, not an official Tangerine port or an affiliated product. Reference screenshots are review material and are excluded from the publishable source archive.
