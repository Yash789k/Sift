# Sift

Sift 0.2 is an offline desktop file converter with a transparent circular wheel and compact image tools. It is an independent, original implementation inspired by [Tangerine](https://www.tangerineformac.com/), for Windows and macOS. **No API keys, accounts or conversion server are required.**

The Windows build passes **65 automated tests, 12 actual-Electron UI checks and seven main-process lifecycle checks**. A real keyboard-driven conversion in the packaged wheel produced a decoded WebP and preserved the source. **Physical Windows drag + modifier activation and all macOS hardware behavior remain unverified.** This is an unsigned development build; the CI configuration has not yet run.

## Run from source

Use Node.js **22.12 or newer** on the target OS and architecture:

```sh
npm ci
npm run setup
npm start
```

Setup downloads dependencies and Electron. Conversions run locally afterward. Windows also needs the .NET Framework C# compiler at its standard Windows location; `npm start` builds the small Explorer selection helper automatically. `Start Sift.cmd` launches an installed Windows checkout.

```sh
npm test
npm run package
```

Packaging builds **only the current OS and CPU architecture**, so installed native libraries match the result. Output is `dist/Sift-win32-<arch>/` or `dist/Sift-darwin-<arch>/Sift.app`. Do not copy Windows node_modules to a Mac. Keep the full packaged folder together.

CI is configured for `windows-latest`, `macos-15` and `macos-15-intel`, using Node 24. It tests and builds without uploading binary artifacts; configuration is not evidence that those builds passed.

## Use the wheel

1. Open Sift from the tray/menu bar or press **Ctrl+Alt+Space** on Windows, **Command+Option+Space** on macOS.
2. Click the center or use **Ctrl+O / Command+O** to choose a file.
3. Click a format wedge to create an output, or press **Tab** / right-click to switch to image tools.
4. In a compact editor, adjust the real preview and apply. Reveal the saved result from the success notice.

The intended global workflow is to drag files from File Explorer/Desktop on Windows or a file source on macOS, then hold **Shift** for formats. Hold **Alt** on Windows or **Command** on macOS for tools. Drop directly on a target. Physical activation still needs target-machine verification. On macOS, use **Enable drag shortcut access…** in the menu to request OS Input Monitoring access, then reopen Sift after granting it. The adapter checks the native drag pasteboard for files.

The Windows source guard excludes browser/text/dialog drags and OS window move/resize loops. Explorer marquee selection or another in-content mouse drag may still briefly open the wheel when a modifier is held: window-class eligibility and advisory selection context cannot establish a genuine file drag. **No conversion occurs without a real file drop or explicit file selection.** This remains a physical-testing limitation.

**Escape** cancels an active operation, returns from an editor, or hides the wheel. Closing/hiding leaves Sift available in the tray/menu bar; **Quit Sift** exits and stops detection.

Outputs save **beside each original** by default. Existing names receive suffixes; originals are preserved. The tray/menu item **Save beside originals** restores this default if a custom destination was previously selected.

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

Preferences and up to 30 recent output records are stored in Electron's user-data directory. History includes file locations; keep it out of source archives and bug reports. The `--demo` flag uses separate local demonstration state.

Native detection reads modifier/button state and pointer location. Windows reads source-window class and Explorer selection context; macOS checks the file drag pasteboard. Files are not uploaded. Bounded local gesture diagnostics record transition events, not typed text, filenames, window titles or pointer coordinates. Disable **Drag shortcuts** or quit Sift to stop detection.

## License and publishing

Original Sift source and project-created assets are **GPL-3.0-or-later**: [LICENSE](LICENSE). Dependencies retain their own licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for development and testing.

The source is prepared locally for its owner to publish. The source-only handoff excludes installed dependencies, compiled binaries, private reference screenshots, profiles/history and machine-specific evidence. Each recipient installs dependencies for a local build.

Public compiled releases require the exact dependency notices and corresponding-source materials described in [DISTRIBUTION.md](DISTRIBUTION.md), including GPL FFmpeg and LGPL HEIC components. CI has no binary artifact publishing step while that audit remains incomplete.
