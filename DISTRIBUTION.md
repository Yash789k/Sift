# Source and binary distribution

## Install Sift

End users download the Apple Silicon `.dmg` or Windows x64 setup `.exe` from [GitHub Releases](https://github.com/Yash789k/Sift/releases). Follow [the installation guide](docs/INSTALLATION.md). Node.js and the conversion tools are bundled. The first release is an **unsigned prerelease**, so operating-system publisher warnings are expected.

This document is for maintainers. Signing, building and providing corresponding source are the publisher's work, not installation steps for users.

## Release contents and verification

The 0.3 prereleases target **macOS 13+ / Apple Silicon** and **Windows 11 / x64**. The release workflow builds each native executable on its target OS. It rebuilds FFmpeg and the HEIC encoder from locked, checksum-verified source archives (content hashes for upstream archives with variable timestamps), replaces the development npm payloads, records the resulting binary hashes and verifies those hashes before packaging. Normal local packaging remains separate from release publication.

Every public release must contain:

- `Sift-<version>-macos-arm64.dmg` and `Sift-<version>-windows-x64-setup.exe`.
- A corresponding-source archive containing Sift's tagged source, the exact codec source archives, native-library source/build recipes, patches, version manifests and license files.
- SHA-256 checksums for the installers and source archive.
- Release notes that identify unsigned/ad-hoc status, test results and any remaining manual checks.

Users only need their installer. The source archive allows recipients to inspect, modify and rebuild the GPL/LGPL components. Keep it available alongside the binaries, at no additional charge. Preserve the source archive even if an upstream download disappears.

## Local installer builds

Sift 0.3 uses pinned electron-builder 26.15.3 as a development dependency. `npm run check:package` validates its configuration without building; `npm run package:dir` creates an unpacked app, and `npm run package` creates a Windows NSIS installer or Mac DMG. The wrapper always sets `publish: never`, while the configuration sets `publish: null`. There is no automatic updater. Release publication is a separate maintainer step after the workflow checks pass.

Build on the actual target OS and CPU architecture with Node 22.12+ (Node 24 recommended). Windows x64 and macOS arm64/x64 are supported build targets. Native Windows ARM64 is rejected because ffmpeg-static 5.3.0 does not supply that binary. Windows requires the standard .NET Framework C# compiler to build SelectionProbe; macOS requires Xcode Command Line Tools. Install dependencies on each target; cross-copying node_modules does not produce a valid native build.

The app includes its production dependencies, native libraries, FFmpeg, HEIC worker and WASM payload. ASAR is disabled to preserve filesystem paths for those executables/workers. Automatic native rebuilding is disabled because the pinned native packages provide platform-specific prebuilt binaries; clean target-host installation and packaged runtime checks remain required. Build scripts, tests, private profiles and dist outputs are excluded from the app through an explicit allowlist.

Windows uses a one-click, per-user installer with no elevation helper or administrator request. Its stable app ID is `org.siftconverter.desktop`; the product and Start-menu name are Sift. The standard installation path is `%LOCALAPPDATA%\Programs\sift-desktop`, respecting Windows' per-user Programs known folder and an existing installation. The app is an `asInvoker` GUI executable. Resource editing remains enabled for the icon and version metadata. No startup registration is added by installation; Sift's setting is opt-in. An upgrade keeps the existing registration. A true uninstall removes only the `org.siftconverter.desktop` value under the current user's Run and StartupApproved/Run keys and the application files, while retaining local state and converted outputs.

macOS builds have bundle ID `org.siftconverter.desktop`, `LSUIElement=true` and minimum system version 13.0. The DMG contains Sift.app and an Applications link. There is no PKG installer, privileged helper or system service. Login at launch uses Electron's main-app service after user opt-in; verify its actual OS approval state. Local and unsigned prerelease builds use an explicit ad-hoc signature with hardened runtime disabled so the app can run on Apple Silicon. Ad-hoc signing is not a Developer ID signature, notarization, or a Gatekeeper-trusted release. The earlier 0.3.1 local Apple Silicon build passed app-signature and DMG integrity checks and packaged image/PDF/audio smoke tests. Those results are historical; every replacement codec and release still needs its own validation.

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

For each installer/architecture, verify fresh install, quiet first/second launch, tray/menu access, optional login enable/disable and an actual login cycle, conversion after the window closes, progress/cancel/error behavior, restart, upgrade and removal. Confirm originals and exports survive removal and that Sift does not remain in login registration. Test Windows source-adjacent Desktop outputs and actual Finder drag/Input Monitoring on the user's Apple Silicon Mac. Check the app's OS minimum on a supported target. The regular CI matrix also builds Intel Mac for development, but the initial release supplies Apple Silicon and Windows x64 installers. Record the actual run and test results in release notes; a configured workflow alone is not a pass.

## Sift source license

Copyright 2026 Sift contributors. Except for identified third-party components, Sift's source and project-created assets are provided under the GNU General Public License, version 3 or any later version (SPDX: GPL-3.0-or-later). The full license is in LICENSE. No Tangerine source or proprietary assets are included; visual/interaction reference does not transfer ownership of Tangerine branding or assets.

## Release codec sources

The development dependency `ffmpeg-static@5.3.0` originally downloaded FFmpeg 6.0 on Apple Silicon with `--enable-nonfree`. That binary's own license says it is unredistributable. **Do not publish that original payload or the earlier local 0.3.1 DMG.** The Windows development payload also lacked a complete assembled corresponding-source bundle.

Release builds replace both platforms' FFmpeg with **FFmpeg 8.1.3**, built by `scripts/codecs/build-ffmpeg.sh`. It enables GPL/version 3 and statically links the locked x264, libvpx, LAME, Opus, libvorbis and libogg source listed in `scripts/codecs/sources.json`. It disables nonfree components, dependency autodetection and networking. Archive the source files, this build script and each platform's generated configuration/version output with the release.

The npm `elheif@0.1.0` payload was built using unpinned dependency revisions. Release builds replace its JavaScript/WASM file with a fresh build from elheif commit `42867c31cf3395a2c789e7081352e554b17a9df4`, **libheif 1.23.6** and **kvazaar 2.3.2**, using Emscripten 3.1.61. The complete build commands and the small upstream compiler-flag adjustment are in `scripts/codecs/build-heic.sh`. This encoder does not include libde265; input decoding remains the separate heic-decode/libheif-js component.

The existing **libheif-js 1.23.5** decoder's build recipe is `catdad-experiments/libheif-emscripten` commit `5c8968a44e9c68ae677e24790d77d001ed7fe7cc`, whose libheif submodule is `413e2a87e6a70b3eccc3a3adc5801179dd2d9e00`. Its Emscripten build uses libde265 1.0.15. These sources and the recipe accompany the release.

Sharp's **libvips 8.18.7** bundle is supplied by `sharp-libvips@1.3.4`. Preserve its `versions.json`, platform build recipes, all covered component sources and patches, including the Windows MXE recipes and librsvg's locked Rust dependencies. Its dynamic library remains a replaceable file because Sift uses unpacked application resources. Recipients can rebuild the complete GPL Sift app with modified components; no proprietary relinking tool or signing key is required for an unsigned build.

Electron 44.9.1 uses Chromium 152.0.7977.167. Its embedded FFmpeg source is pinned at `2b68d2babae73714846961fb0ee47e3b3d2e39a9`; that source and Electron's release source/build patches accompany the release too. This is separate from Sift's command-line converter.

Canvas/Skia, Electron/Chromium and the other production dependencies retain their notices. Sift collects upstream copyright/license files in the installed app's `licenses` directory; Electron's license and Chromium credit files are also preserved. The top-level dependency table is a guide, not a substitute for these full notices.

[FFmpeg licensing guidance](https://ffmpeg.org/legal.html), [GPLv3 section 6](https://www.gnu.org/licenses/gpl-3.0.html#section6), [libheif license](https://github.com/strukturag/libheif/blob/master/COPYING).

## Maintainer release sequence

1. Update `package.json`, `package-lock.json` and the README download links to the intended version. Review dependency versions and source checksums together.
2. Run **Build installers** in GitHub Actions. Inspect any failed build or test; do not publish partial outputs.
3. Verify the packaged app on each native target. Exercise real first-open warnings, file conversion, tray/menu access and uninstall on representative machines. Automated smoke tests do not replace a physical drag, Input Monitoring approval or a full login cycle.
4. Assemble the matching source archive and full notices. Confirm each installer includes the replacement codecs recorded in `build/release-codecs.json` and excludes the old nonfree payload.
5. Create a draft GitHub release with **Set as a pre-release**, using the full tested commit SHA as its target. Write clear platform instructions and honest test limitations in the notes.
6. Run **Publish verified prerelease** in GitHub Actions and enter the successful **Build installers** run ID (the number in its URL). This explicitly publishes the prepared draft: it downloads that run's artifacts directly on GitHub, verifies the source archive against the tested commit and every upstream checksum, uploads both installers/source/checksums, and checks GitHub's stored asset digests before publishing. It refuses a failed build, a different target commit, changed existing assets or an already-public release. The build workflow itself remains read-only. Do not describe an ad-hoc Mac signature as notarization or a verified publisher.

For a local check without uploading or publishing, set `GH_REPO=owner/repository` and run `python3 scripts/publish-verified-release.py <run-id> <downloaded-artifacts-folder> --check-only` after signing in with `gh`. The same checks run during publication.

Future signed releases can use the credential configuration above. Never commit certificates, tokens, passwords, profiles, private files or machine-specific diagnostic evidence.
