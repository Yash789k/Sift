# Contributing to Sift

Sift is an original desktop implementation of the drag-to-transform interaction, with a radial interface informed by Tangerine. Keep the Sift name and original code/assets. Do not submit proprietary Tangerine source, extracted icons, screenshots, or other material without a compatible redistribution license.

If you only want to **use Sift**, follow the [installation guide](docs/INSTALLATION.md) and download an installer from [Releases](https://github.com/Yash789k/Sift/releases). The tools and commands below are only for developing Sift.

## Local development

Use Node.js 22.12 or later and the platform you intend to test:

```sh
npm ci
npm run setup
npm test
npm start
```

Installation downloads dependencies and the Electron/FFmpeg components. Normal file operations run locally. Keep package-lock.json committed. Follow package.json for current build commands; platform packaging and native gesture support must be tested on the corresponding OS.

## Build an installer locally

Use Node.js **22.12+** (Node 24 recommended), installed for your target architecture. Windows builds need the .NET Framework C# compiler supplied with Windows; Mac builds need Xcode Command Line Tools. These requirements apply to the developer, not the person installing Sift.

```sh
npm run test:desktop
npm run check:package
npm run package:dir
npm run package
```

`package:dir` creates an unpacked test app. `package` creates a Mac `.dmg` or Windows `.exe` under `dist/`; neither uploads anything. Build Windows x64 on Windows x64 and Mac ARM64 on an Apple Silicon Mac. Do not copy `node_modules` between systems. Local Intel Mac builds are supported but are not supplied by the initial release workflow.

On a Mac, a synced Documents/iCloud directory can add Finder metadata that breaks code signing. Use an ordinary local checkout or an output directory outside the synced folder, for example `npm run package -- --out /private/tmp/sift-build`.

The npm codec downloads are for local development. **A public release must use the replacement codec builds and matching source materials in [DISTRIBUTION.md](DISTRIBUTION.md).** In particular, the old Mac FFmpeg download is not redistributable. Never publish a plain local build as a release.

`npm test` checks conversion and lifecycle logic. `npm run test:desktop` exercises the real Electron main process, preload, renderers and worker, with synthetic files and substituted picker/reveal boundaries. It needs a desktop session and does not prove physical Explorer/Finder dragging or an actual login cycle.

## Changes we can review

Describe the user-visible problem, the behavior after the change, and the evidence. For wheel or editor changes, include a non-sensitive screenshot/video and compare the actual geometry, labels, hover selection, desktop transparency, and compact editor behavior. A rectangular palette with similar colors is not an equivalent implementation.

For file operations, test actual output pixels/content, file type, orientation, page order, collision safety, unchanged originals, failure cleanup, and cancellation where relevant. Preserve source-adjacent output behavior. Do not report successful conversion before a valid output exists.

For native gestures, test a real drag on Windows and macOS. A state-machine replay or direct callback invocation is valuable regression coverage but must be labeled as such. Record OS version, hardware/architecture, display scale, and observed latency. Do not call macOS runtime support verified from a Windows cross-build.

Build on the target OS/CPU architecture; packaging deliberately rejects cross-target dependency reuse. On a Mac, install fresh dependencies, request Input Monitoring through Sift's menu, reopen the app after granting access, and exercise a real Finder file drag with Shift (formats) and Command (tools). On Windows use Explorer/Desktop with Shift and Alt. Check target selection, actual output decoding, unchanged sources, screen edges, and tool-editor transitions. The normal CI matrix is Windows, Apple Silicon macOS and Intel macOS. The separate release workflow builds the Apple Silicon and Windows x64 deliverables. Check the repository's Actions page for the status of a particular commit.

Keep local paths, personal files, account identifiers, settings/history, diagnostic logs, reference screenshots, generated binaries, and node_modules out of commits. Reproduce bugs with synthetic files. New dependencies need compatible licenses and an update to THIRD_PARTY_NOTICES.md and DISTRIBUTION.md.

## License

Sift's original source and project-created assets are licensed under GPL-3.0-or-later; see LICENSE. Contributions are accepted under the same license. Retain attribution and upstream notices for third-party material. State the source and license of any material you did not create.

No contributor agreement or transfer of copyright is required by these project instructions.
