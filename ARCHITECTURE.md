> Installation: users download a Mac DMG or Windows setup EXE from [Releases](https://github.com/Yash789k/Sift/releases). See [the installation guide](docs/INSTALLATION.md). The baseline analysis below documents the earlier refactor, not current end-user setup.

# Background utility: repository assessment and approach

Assessment date: 2026-10-22. Baseline: Sift 0.2.0, commit `fa5efff`.

## What is already here

| Layer | Existing implementation | Decision |
| --- | --- | --- |
| Desktop | Electron 44.9.1; CommonJS main/preload; HTML/CSS/JavaScript renderer | Retain Electron and the radial wheel |
| Images | Sharp/libvips, BMP decoder, HEIC decoder and elheif WASM encoder | Reuse conversion code |
| Documents | pdf-lib, PDF.js, canvas, docx | Reuse supported PDF/image/document operations |
| Audio/video | Bundled ffmpeg-static | Keep offline child-process conversions |
| Image tools | `tools-engine.cjs`: crop, background, compression, metadata, edits, text, redaction | Keep the existing tools and compact editors |
| Native integration | Koffi; Windows C# selection/desktop refresh helper; macOS pasteboard/modifier reader | Keep platform-specific integration |
| Distribution | `@electron/packager` folder output; no installer, startup registration or signing pipeline | Replace only the packaging tool |
| Platforms | Windows and macOS source/build paths; Windows runtime tested previously | Separate native builds for Windows x64, macOS ARM64 and macOS x64 |

The baseline already has a tray icon, a single-instance lock and windows that hide on close. Its first launch opens the wheel; its menu lacks a complete progress/settings experience. Main-process IPC calls conversion functions directly. HEIC encoding alone uses a dedicated worker. Its Quit handler aborts work but does not wait for asynchronous cleanup. The source instructions put developer setup ahead of installation, which is inappropriate for ordinary users.

## Recommended implementation

Keep the existing engine, formats, native gesture integration and glass wheel. Use Electron's existing tray, window, dialog and login-item APIs. Move engine calls behind a lazy `worker_threads` service. Add a small jobs/settings window that is created only on request. A normal launch creates no application window; the OS tray/menu bar is the entry point. This requires no new desktop framework, conversion service, HTTP listener, privileged service or cloud account.

The worker owns expensive library loading and serial execution. The main process owns the tray, OS integration, job state and IPC. Renderers receive structured data through narrow, context-isolated preloads. Mutating requests cannot start twice while the same operation is already in flight. A deliberate repeat after completion can create another collision-safe output.

Cancellation is cooperative: signal the engine, wait for FFmpeg/native work to finish safely, and let existing cleanup run. Explicit Quit offers to keep running or cancel and quit; shutdown waits for cleanup instead of terminating a worker during output publication. Already completed files remain available when later items fail or are cancelled.

The conversion worker can exit when idle. The wheel is loaded on first use and retained for fast subsequent drags; the settings window is separate and optional. Electron still includes Chromium and Node, so the installation is substantial. This refactor reduces idle work and makes installation straightforward; it does not turn Electron into a tiny native binary. Replacing Electron solely to shrink that footprint would be a separate framework migration with substantial gesture, renderer and packaging work.

In 0.3.1, a fully successful job hides the wheel or editor and creates a compact, temporary success window. Its Show action is available for two seconds after the renderer is ready and the native window is visible, followed by a 180 ms fade and window destruction. The main process owns the output path and validates reveal requests. Generation tokens invalidate old notifications on new work; rejected conflicting requests cannot invalidate the active job. Native dialogs defer dismissal, and failed, partial or cancelled work retains recovery controls. The notification adds no persistent idle renderer.

The wheel uses a real transparent aperture, neutral translucent SVG petals, inset edge highlights and a radial orange selection. Its soft hover feedback is synthesized locally with Web Audio, created on first use, rate-limited between targets, suspended while idle and silent while busy. No audio asset, new runtime dependency, network request or system volume change is needed.

## Implementation sequence and dependencies

1. Add an engine worker/service with progress messages, cancellation, duplicate suppression, idle disposal and worker-failure handling. Use Node's built-in worker APIs; no new runtime package.
2. Make normal startup silent; preserve single-instance locking; build the complete tray/menu-bar menu. Create wheel/settings windows only when requested and keep window-close separate from Quit.
3. Expose bounded job history and local diagnostic logs; add jobs/settings UI, output-folder choices, cancellation and visible OS startup status.
4. Use `app.setLoginItemSettings` / `app.getLoginItemSettings` for optional user login. On macOS 13+, use `mainAppService`, backed by SMAppService. Read registration status from the OS every time settings are refreshed. Do not treat a saved preference as evidence of registration.
5. Replace `@electron/packager` with a pinned **electron-builder development dependency** to produce Windows NSIS installers and macOS app/DMG outputs. All existing production conversion dependencies remain. Disable publishing in local build commands.
6. Run engine and lifecycle tests, exercise the actual Electron IPC/renderers, build Windows distribution artifacts, and verify normal startup, conversion, close/reopen and safe shutdown. Build/test macOS on a Mac before describing it as verified.

Electron documents the modern login API and returned registration states in its [app API](https://www.electronjs.org/docs/latest/api/app#appgetloginitemsettingsoptions). macOS can return `requires-approval`; that must be shown to the user. In a development checkout, the launch-at-login control is unavailable so it cannot accidentally register the generic Electron executable. Windows registration is current-user only and checks effective startup approval as well as the matching executable/arguments.

## Packaging, runtime and permissions

- **Windows:** use a per-user NSIS installer with a stable install path. It installs the complete bundled Electron runtime and production modules, creates shortcuts and an uninstaller, and requires no Node/Python/compiler setup by the recipient. It remains a user-session GUI process; no Windows Service or console window. Startup is opt-in. A portable folder can be used for local testing if kept together in a stable location.
- **macOS:** build a `.app` and disk image on the target architecture. Set `LSUIElement=true`, minimum macOS 13, and no persistent Dock icon. Put the app in Applications before registering login startup. The first public prerelease is ad-hoc signed and not notarized, with the warning and user-controlled opening process documented in the installation guide. Developer ID signing, hardened runtime and notarization are the later path to Apple-verified distribution; these require the distributor's Apple credentials. Do not bypass Gatekeeper or change privacy permissions programmatically.
- **Native binaries:** Sharp, canvas, Koffi and FFmpeg are platform/architecture-specific. Install dependencies and package on each target OS/CPU. The Windows C# helper is compiled during the developer build and included in the app. Recipients do not compile it. Its .NET Framework runtime is supplied by supported Windows installations; test the actual supported Windows baseline.
- **File access:** use user-selected local files and an accessible destination. Default output is beside the source; protected directories, read-only filesystems, offline cloud placeholders and disconnected volumes can fail. Show a useful error and allow a different output folder. On macOS, folder access and Input Monitoring are OS-owned permissions; the user grants them. No Full Disk Access requirement is introduced.
- **Output safety:** retain engine validation, pixel/size/batch limits, temporary output, atomic exclusive publication, numbered collisions and source preservation. Do not add overwrite behavior. Cancellation may wait for an in-progress native encode to return; that protects publication/cleanup.
- **Privacy:** no upload path is added. Recent output paths and logs stay in the local application-data directory. Logs are bounded and should describe operations/failures without file contents.
- **Updates/removal:** initial distribution uses manual installer/app replacement. No updater, update server or background downloading is required. Quit before replacement; preserve saved outputs. Uninstallation and optional removal of local settings/logs are documented separately.

## Deferred and externally required work

Finder Quick Actions could later forward selected file URLs to the existing application. They are optional: extension registration, signing and another discovery/permission path add scope without being needed for the tray or drag workflow.

Windows code signing and macOS signing/notarization need distributor-owned credentials. A macOS build and hardware acceptance test cannot be substituted by Windows tests. Release codecs are rebuilt from pinned source, and matching source/notices must accompany the installers as described in `DISTRIBUTION.md`. Publishing source and producing local unsigned test builds do not establish readiness for a public installer release.
