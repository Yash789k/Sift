# Source and binary distribution

## Current distribution decision

The public repository distributes Sift source and project-created assets under GPL-3.0-or-later. Public installer releases are not available yet. CI may test/build Windows and macOS, but must not upload public binary artifacts while the binary-source obligations below remain unresolved.

The source archive includes Sift source, package manifests/lockfile, build configuration/scripts, tests with synthetic fixtures, project-created sample assets, LICENSE, and these documentation files. Exclude node_modules, Electron/FFmpeg executables, installed packages, installers/portable builds, user profiles, history, logs, absolute-path evidence, private screenshots, secrets, and intermediate work. npm ci and npm run setup obtain third-party dependencies for each recipient's local build.

## Local installer builds

Sift 0.3 uses pinned electron-builder 26.15.3 as a development dependency. `npm run check:package` validates its configuration without building; `npm run package:dir` creates an unpacked app, and `npm run package` creates a Windows NSIS installer or Mac DMG. The wrapper always sets `publish: never`, while the configuration sets `publish: null`. There is no automatic updater or release upload step.

Build on the actual target OS and CPU architecture with Node 22.12+ (Node 24 recommended). Windows x64 and macOS arm64/x64 are supported build targets. Native Windows ARM64 is rejected because ffmpeg-static 5.3.0 does not supply that binary. Windows requires the standard .NET Framework C# compiler to build SelectionProbe; macOS requires Xcode Command Line Tools. Install dependencies on each target; cross-copying node_modules does not produce a valid native build.

The app includes its production dependencies, native libraries, FFmpeg, HEIC worker and WASM payload. ASAR is disabled to preserve filesystem paths for those executables/workers. Automatic native rebuilding is disabled because the pinned native packages provide platform-specific prebuilt binaries; clean target-host installation and packaged runtime checks remain required. Build scripts, tests, private profiles and dist outputs are excluded from the app through an explicit allowlist.

Windows uses a one-click, per-user installer with no elevation helper or administrator request. Its stable app ID is `org.siftconverter.desktop`; the product and Start-menu name are Sift. The standard installation path is `%LOCALAPPDATA%\Programs\sift-desktop`, respecting Windows' per-user Programs known folder and an existing installation. The app is an `asInvoker` GUI executable. Resource editing remains enabled for the icon and version metadata. No startup registration is added by installation; Sift's setting is opt-in. An upgrade keeps the existing registration. A true uninstall removes only the `org.siftconverter.desktop` value under the current user's Run and StartupApproved/Run keys and the application files, while retaining local state and converted outputs.

macOS builds have bundle ID `org.siftconverter.desktop`, `LSUIElement=true` and minimum system version 13.0. The DMG contains Sift.app and an Applications link. There is no PKG installer, privileged helper or system service. Login at launch uses Electron's main-app service after user opt-in; verify its actual OS approval state. Default local builds use an explicit ad-hoc signature with hardened runtime disabled, solely to support local development. Ad-hoc signing is not a Developer ID signature, notarization, or a Gatekeeper-trusted release. **Mac package creation and runtime behavior have not yet been verified on Mac hardware.**

## Optional signing and notarization

Credentials are not included or currently available. Configure these variables in the build environment or a secret store; never commit certificates, passwords or API keys. Normal local commands do not submit an app to Apple or any release host.

For Windows, set `SIFT_SIGN=1` and electron-builder's `WIN_CSC_LINK` (certificate file/base64) with `WIN_CSC_KEY_PASSWORD`, or its generic `CSC_LINK`/`CSC_KEY_PASSWORD` equivalents. A suitable Windows signing certificate/provider is required. `SIFT_SIGN=1` enables `forceCodeSigning`, so missing signing credentials fail the build instead of silently producing an unsigned release. Verify the final installer and executable Authenticode signatures on Windows; no successful signing run is claimed here.

For a signed Mac build, set `SIFT_SIGN=1` and a **Developer ID Application** certificate through `CSC_LINK` and `CSC_KEY_PASSWORD`, or a matching keychain identity through `CSC_NAME`. The signed path enables hardened runtime and the project's JIT/executable-memory entitlements; FFmpeg is explicitly included among signed binaries. Verify nested native modules and the final bundle, not only the outer app. The identity, entitlements and third-party binaries require an actual signed Mac test.

Notarization is a separate, explicit opt-in: set **both** `SIFT_SIGN=1` and `SIFT_NOTARIZE=1` on a Mac. This submits the signed app to Apple. Supply one complete authentication set:

- `APPLE_API_KEY` (absolute path to the .p8 file), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- `APPLE_KEYCHAIN_PROFILE`, with `APPLE_KEYCHAIN` if a non-default keychain is needed.

The wrapper rejects incomplete notarization credentials and never prints their values. Electron-builder's notarization integration submits and staples the app; verify the result with `codesign --verify --deep --strict --verbose=2`, `xcrun stapler validate` and `spctl --assess --type execute --verbose=2` against the final Sift.app. Run the app from a fresh Mac user account with the delivered DMG before marking it release-ready. Signing/notarization does not resolve dependency licensing or constitute runtime verification. [Pinned builder signing options](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.15.3/packages/app-builder-lib/src/options/macOptions.ts), [Electron notarization](https://github.com/electron/notarize), [Apple notarization guidance](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## Required packaged-app verification

For each installer/architecture, verify fresh install, quiet first/second launch, tray/menu access, optional login enable/disable and an actual login cycle, conversion after the window closes, progress/cancel/error behavior, restart, upgrade and removal. Confirm originals and exports survive removal and that Sift does not remain in login registration. Test Windows source-adjacent Desktop outputs and actual Finder drag/Input Monitoring on the user's Apple Silicon Mac. Check the app's OS minimum on a supported target. CI is configured for Windows, Apple Silicon and Intel Mac, but configured workflows are not executed results. Public artifacts remain disabled pending the license audit below.

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
