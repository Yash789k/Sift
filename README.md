# Sift

Sift 0.3 is an offline file converter that stays in the Windows notification area or macOS menu bar. Its circular wheel and compact editors appear when needed. It is an independent, original implementation inspired by [Tangerine](https://www.tangerineformac.com/). **No API keys, accounts, Node.js installation or conversion server are needed to use a packaged app.**

## Install

### Windows 10/11, x64

1. Run `Sift-0.3.1-windows-x64-setup.exe` from the local build handoff.
2. Sift installs for your Windows account and starts quietly. Look for its icon in the notification area; Windows may put it under **Show hidden icons**.
3. Open the icon's menu and choose **Convert files…**, **Current jobs…** or **Settings…**.

The installer includes Electron, the conversion engine and its native dependencies. It needs no administrator account or console window. The standard location is `%LOCALAPPDATA%\Programs\sift-desktop\Sift.exe`; Windows can redirect its per-user Programs folder. A Start-menu shortcut is created. Opening Sift again keeps one background instance.

**Launch at login is off until you enable it** in Settings or the tray menu. Settings reads the operating system's actual registration/approval state. If Windows Startup apps has disabled Sift, it reports that state.

The local Windows installer is unsigned unless signing credentials were explicitly supplied at build time. This repository does not provide a public download or claim a trusted publisher signature.

### macOS 13 or later

Choose the `arm64` DMG for an Apple Silicon Mac or `x64` for an Intel Mac. Open `Sift-0.3.1-macos-<arch>.dmg`, drag **Sift.app** into **Applications**, eject the disk image, then open Sift. It runs in the menu bar without a Dock icon.

For drag shortcuts, use **Settings → Open shortcut access…**, enable Sift under **System Settings → Privacy & Security → Input Monitoring**, then quit and reopen Sift. Manual **Convert files…** remains available. Launch at login is optional; macOS may require approval under **General → Login Items**.

**The macOS build and hardware workflow still require verification on a Mac.** The local default uses an ad-hoc signature, which does not establish Developer ID/Gatekeeper trust or notarization. A signed, notarized release is a separate build step described in [DISTRIBUTION.md](DISTRIBUTION.md). No Mac runtime pass is claimed.

## Use Sift

- **Convert files…** chooses files and opens the format wheel. In an open wheel, **Ctrl+O / Command+O** also chooses files.
- Drag files from Explorer/Desktop on Windows or Finder on macOS, hold **Shift**, and drop on a format. Hold **Alt** on Windows or **Command** on macOS for tools.
- Click **Tools ›** in the center well for Crop, Add BG and the other image tools; **Formats ›** returns to conversion. **Tab** or right-click also switches. The switch preserves selected files.
- Successful conversions and tool saves close the wheel/editor automatically. A small **Show** notification stays available for two seconds, then fades away. Failures and partial results remain available to review; saved results are also in **Current jobs…**.
- The wheel has a transparent center around its controls, clear glass petals and an orange selection that deepens toward the outside. Moving between available wheel controls plays a quiet local click.
- **Current jobs…** shows progress, cancellation, errors and saved results. Closing a window leaves the background utility running; use **Quit Sift** to exit.
- **Ctrl+Alt+Space / Command+Option+Space** opens the wheel manually. Arrow keys navigate its controls; **Enter** or **Space** activates the focused control. **Escape** cancels an active wheel operation, returns from an editor or hides the wheel.

Outputs save **beside each original**. Existing names get suffixes and originals are preserved. Settings can choose a destination or restore **Use original folder**. **Open output folder** and result links reveal saved files.

Windows saves notify Explorer. For Desktop sources, including a redirected OneDrive Desktop, a helper also tries a free icon position near the original without moving other icons or changing Auto arrange/Hide icons settings. If Windows controls placement or no slot is available, the output remains saved. Finder handles macOS icons normally.

Windows physical file drag and source-adjacent conversion were user-verified in the previous wheel build. The source guard excludes browser/text/dialog drags and window move/resize loops. Explorer marquee selection may still briefly open a wheel when a modifier is held; no conversion occurs without a file drop or explicit selection. The new lazy startup path has automated desktop coverage; a fresh physical drag check on each release remains part of platform acceptance.

## Update or remove

There is **no automatic updater**. Quit Sift, then run the newer Windows installer, or replace the app in Applications from a newer Mac DMG. Keep the application name/ID and the Windows account unchanged to retain settings. The installer preserves opt-in login registration during upgrades.

On Windows, use **Settings → Apps → Installed apps → Sift → Uninstall**. Removal deletes the installed application and its Sift login registration. On macOS, turn off **Launch at login** in Sift, quit it, then move **Sift.app** from Applications to Trash. Check macOS Login Items if removing an app that no longer launches.

Converted files are retained. Preferences, local logs and recent output records are retained too, at `%APPDATA%\Sift` on Windows or `~/Library/Application Support/Sift` on macOS. Remove that specific folder only if you also want to erase Sift's local state.

## Formats

| Input | Output |
|---|---|
| PNG, JPG/JPEG, WebP, AVIF, TIFF, GIF, SVG, BMP, HEIC/HEIF | PNG, JPG, WebP, HEIC, GIF, AVIF, BMP, TIFF, PDF, DOCX |
| PDF | One PNG/JPG per page, TXT, DOCX |
| MP3, WAV, M4A, AAC, FLAC, OGG, Opus, AIF/AIFF | MP3, WAV, M4A, FLAC, OGG |
| MP4, MOV, M4V, WebM, MKV, AVI, MPEG/MPG, WMV | MP4, WebM, GIF; extract MP3/WAV/M4A audio |

The image wheel omits the source format. A JPEG shows PNG/WEBP/HEIC/GIF/AVIF/BMP/PDF/DOCX around TIFF; a PNG exposes JPG instead of PNG, and a TIFF uses DOCX at the center. PDF has four wedges. The engine also supports image-to-multipage-PDF creation and PDF merging; capability coverage does not imply every engine option has a separate wheel control.

HEIC encoding is real local WebAssembly, with a fixed balanced quality preset and white matte for transparency. Image-to-DOCX embeds an image; it does not recognize text. PDF-to-DOCX extracts editable text with reflowed layout and embeds image-only pages; PDF-to-TXT requires selectable text. **No OCR, layout-perfect PDF-to-Word, camera RAW or archive conversion is claimed.**

PDF image export uses 144 dpi bounded to 20 megapixels per page. Encrypted PDFs are unsupported. Input extensions identify a category; unusual codecs or damaged files may fail. Up to 100 files per batch, 100-megapixel image inputs and 250 MiB per PDF are allowed.

## Image tools

| Tool | Operation |
|---|---|
| Crop | Drag handles, enter dimensions, or use Free, 1:1, 16:9, 9:16, 4:3 or 3:4 |
| Add BG | Preset/color background, padding, corners, shadow and aspect ratio |
| Compress | Quality and longest-edge limit in pixels, with a real preview |
| Metadata | Inspect embedded metadata; create a metadata-removed copy |
| Edit | Resize, rotate, flip, brightness and saturation |
| Annotate | Text, color, font size and position |
| Redact | Solid or blurred rectangular area |

Editors operate on the first frame/page. Supported GIF/WebP conversion can preserve animation; static outputs and applicable transforms report first-frame behavior. Metadata removal re-encodes a copy and can change file size; it is not a file-timestamp editor. Compression may not make an already efficient input smaller. Successful files remain when a later batch item fails or is cancelled.

## Local state and privacy

Preferences, recent output records and bounded diagnostic logs stay in Electron's user-data directory. History and errors can include file locations; review them before sharing a bug report and exclude them from source archives. Settings offers **Open local logs**. The `--demo` flag uses separate demonstration state.

Native detection reads modifier/button state and pointer location. Windows reads source-window class and Explorer selection context; macOS checks the file drag pasteboard. Files are not uploaded. Bounded local gesture diagnostics record transition events, not typed text, filenames, window titles or pointer coordinates. Disable **Drag shortcuts** or quit Sift to stop detection.

## Build from source

Use Node.js **22.12 or newer** (Node 24 recommended) on the target OS and CPU architecture:

```sh
npm ci
npm run setup
npm start
```

Development startup also stays in the tray/menu bar; login registration is available only in a packaged app. Dependencies and Electron download during setup. Conversions run locally afterward. Windows needs the standard .NET Framework C# compiler for its small Explorer helper; the packaged installer already includes that helper. Mac builds need Xcode Command Line Tools.

```sh
npm test
npm run test:desktop
npm run check:package
npm run package:dir
npm run package
```

`package:dir` creates an unpacked app for testing. `package` creates a Windows per-user NSIS installer or a macOS DMG with the app bundle. Neither publishes files. Output is under `dist/`: `win-unpacked/Sift.exe`, `Sift-<version>-windows-x64-setup.exe`, or a `mac[-arm64]/Sift.app` and `Sift-<version>-macos-<arch>.dmg`.

Build Windows x64 on Windows x64, Apple Silicon on an ARM64 Mac, and Intel on an Intel Mac. The wrapper rejects cross-architecture builds to keep Sharp, canvas, Koffi and FFmpeg matched to the host. Windows ARM64 is not a native build target because the current FFmpeg package lacks that binary. Do not copy Windows `node_modules` to a Mac. The source launchers remain developer conveniences; end users use the installer/app.

CI is configured for Windows x64, Apple Silicon and Intel Mac runners. It installs, tests and builds without artifact uploads. CI configuration, an installer file and a code signature are not substitutes for target-machine runtime checks. See [DISTRIBUTION.md](DISTRIBUTION.md) for signing, notarization and the public-binary release boundary.

`test:desktop` runs the real main process, preload, renderer and conversion worker in Electron. Fixtures replace native file-picker and Quit-confirmation choices; it does not simulate an Explorer/Finder drag. It needs a desktop session. The 0.3 Windows revision passed **95 automated tests** and **seven Electron integration scenarios** covering silent startup, closing/reopening windows, conversion/tool outputs, collisions, damaged input, duplicate jobs and safe Quit. The packaged Windows executable passed the same scenarios plus a real startup registration/readback/removal test. Startup was restored to off. macOS hardware verification and a fresh physical drag check of the lazy startup path remain outstanding; configured CI is not evidence of a remote pass.

## License and publishing

Original Sift source and project-created assets are **GPL-3.0-or-later**: [LICENSE](LICENSE). Dependencies retain their own licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for development and testing.

The source is prepared locally for its owner to publish. The source-only handoff excludes installed dependencies, compiled binaries, private reference screenshots, profiles/history and machine-specific evidence. Each recipient installs dependencies for a local build.

Public compiled releases require the exact dependency notices and corresponding-source materials described in [DISTRIBUTION.md](DISTRIBUTION.md), including GPL FFmpeg and LGPL HEIC components. CI has no binary artifact publishing step while that audit remains incomplete.
