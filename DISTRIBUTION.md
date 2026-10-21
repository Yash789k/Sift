# Source and binary distribution

## Current distribution decision

Prepare a clean local source repository/archive for the user to publish. This task does not create a public GitHub repository, upload release files, or assert a public release exists. CI may test/build Windows and macOS, but must not upload public binary artifacts while the binary-source obligations below remain unresolved.

The source archive includes Sift source, package manifests/lockfile, build scripts, tests with synthetic fixtures, project-created sample assets, LICENSE, and these documentation files. Exclude node_modules, Electron/FFmpeg executables, installed packages, portable builds, user profiles, history, logs, absolute-path evidence, private screenshots, secrets, and intermediate work. npm ci and npm run setup obtain third-party dependencies for each recipient's local build.

## Sift source license

Copyright 2026 Sift contributors. Except for identified third-party components, Sift's source and project-created assets are provided under the GNU General Public License, version 3 or any later version (SPDX: GPL-3.0-or-later). The full license is in LICENSE. No Tangerine source or proprietary assets are included; visual/interaction reference does not transfer ownership of Tangerine branding or assets.

## Bundled FFmpeg evidence

The locally installed Windows executable identifies itself as 6.1.1-essentials_build-www.gyan.dev, compiled with GCC 12.2.0/MSYS2, including --enable-gpl, --enable-version3, and --enable-static. Its -L output says GPL version 3 or later. SHA-256:

`04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`

The ffmpeg-static package is 5.3.0, GPL-3.0-or-later. Its downloaded ffmpeg.exe.README names [FFmpeg revision e38092ef93](https://github.com/FFmpeg/FFmpeg/commit/e38092ef93), build configuration, and external libraries; ffmpeg.exe.LICENSE accompanies it. This identifies the binary but does not establish that a complete corresponding-source bundle has been assembled. macOS downloads a different binary and needs its own version/hash/license/source audit. [ffmpeg-static upstream](https://github.com/eugeneware/ffmpeg-static), [Gyan build information](https://www.gyan.dev/ffmpeg/builds/).

## Before a public binary release

A binary distributor must satisfy each bundled component's license. For GPL-covered FFmpeg, provide the complete corresponding source for the exact binary, including covered linked libraries, modifications, and necessary build scripts/configuration, by an applicable GPL section 6 method. An application GPL label or a link to the main FFmpeg commit alone is not proof that this is complete. Preserve license/copyright notices. [GPLv3 section 6](https://www.gnu.org/licenses/gpl-3.0.html#section6), [FFmpeg licensing guidance](https://ffmpeg.org/legal.html).

libheif-js 1.23.5 declares LGPL-3.0 and ships compiled libheif JavaScript/Wasm. Review its exact upstream source, build scripts, component licenses, and LGPL requirements before distributing those compiled outputs. Sharp/libvips and canvas/Skia also include native dependency notices; Electron bundles Chromium and other licensed components. The direct dependency table is not a complete binary bill of materials.

The HEIC encoder also uses elheif 0.1.0: its wrapper is MIT, but its WebAssembly includes libheif and libde265 libraries under LGPLv3 and kvazaar under BSD-3-Clause. The [elheif core build](https://github.com/hpp2334/elheif/blob/main/core/CMakeLists.txt) fetches these projects without pinned GIT_TAG revisions and links static libraries. The [WASM build](https://github.com/hpp2334/elheif/blob/main/wasm/CMakeLists.txt) embeds the result into one JavaScript file. The exact dependency revisions used for the npm binary have not been established or reproduced. Installed `pkg/elheif-wasm.js` SHA-256: `a2e7c699be9a0025c121a52698968375ef6e472c04d4832d58db0179391e1fe3`. Obtain matching source/build materials and preserve notices before a public compiled release; the wrapper's MIT declaration does not cover all embedded components. [libheif license](https://github.com/strukturag/libheif/blob/master/COPYING), [libde265 license](https://github.com/strukturag/libde265/blob/master/COPYING), [kvazaar license](https://github.com/ultravideo/kvazaar/blob/master/LICENSE).

For every target platform/architecture, retain a reproducible dependency manifest, native binary hashes, upstream notices, and matching source/build materials; verify a clean build and the actual application on that platform. Record what remains unverified. Do not publish a Windows-tested macOS package as runtime-verified.

## Current boundary

The source-only archive can be prepared without redistributing dependency binaries. Public binary release remains gated on the exact corresponding-source and notice audit. Existing local portable files are a personal test deliverable, not an assertion that public redistribution requirements have been completed. No public repository or download URL is claimed by this document.
