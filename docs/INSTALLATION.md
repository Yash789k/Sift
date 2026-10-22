# Install Sift

Sift is a desktop app. Download it once, install it, and use it offline. Its installer includes Node.js and the other components it needs; nothing needs to be installed separately.

## 1. Choose your download

1. Open [Sift Releases](https://github.com/Yash789k/Sift/releases).
2. Open the newest release and read its notes. The initial release is marked **Pre-release** because it is a test version.
3. Expand **Assets** if the list of downloads is collapsed.
4. Download the file for your computer:

| Computer | File ending |
|---|---|
| Apple Silicon Mac — M1, M2, M3, M4 or newer | `macos-arm64.dmg` |
| Windows 11 — Intel/AMD 64-bit PC | `windows-x64-setup.exe` |

On a Mac, **Apple menu → About This Mac → Chip** identifies your chip. On Windows, **Settings → System → About → System type** should say **x64-based processor**. The first prerelease does not supply an Intel Mac or native Windows ARM installer. macOS 13 or later is required.

Ignore **Source code (zip)**, **Source code (tar.gz)** and **Corresponding source** if you only want to install the app. Those downloads let developers inspect and rebuild Sift. You do not need to download them to use it.

## 2. Install on a Mac

1. Open Downloads and double-click `Sift-<version>-macos-arm64.dmg`.
2. A window shows **Sift** and **Applications**. Drag Sift onto Applications and wait for the copy to finish.
3. Eject the Sift disk in Finder's sidebar.
4. In Finder, open **Applications**, then double-click **Sift**. Open this installed copy instead of the copy inside the disk image.
5. Look at the menu bar at the top of the screen. Sift runs there, so you should not expect a persistent Dock icon or a large welcome window.

### If macOS blocks the first opening

This prerelease uses an ad-hoc signature, not an Apple Developer ID signature, and is not notarized. Apple may say it cannot verify the developer or check the app for malicious software.

After attempting to open Sift, and **only if you trust this repository and downloaded its release asset**, open **System Settings → Privacy & Security**, scroll to the security message about Sift, and use **Open Anyway** if offered. Confirm the next prompt. Apple's [official instructions](https://support.apple.com/en-us/102445) describe this process.

If macOS explicitly reports malware, the download is damaged, or your computer is managed by work/school and the option is unavailable, stop and report the exact message. Do not disable Gatekeeper or remove system security settings. A normal unsigned-app warning and a malware detection are different messages.

### Optional: enable drag shortcuts

1. On the first launch, macOS may ask for Input Monitoring access. If you skipped it, click Sift's menu-bar icon → **Enable drag shortcuts…**. You can also use **Settings… → Open shortcut access…**. This registers Sift in the permission list and opens the settings page.
2. Enable Sift under **System Settings → Privacy & Security → Input Monitoring**.
3. Choose **Quit & Reopen** when macOS asks, or quit Sift using its menu and reopen it from Applications.
4. In Finder, select a file, **hold the mouse button down and start dragging**, then hold **Shift**. The wheel appears around the pointer. Drag onto a format and release the mouse button. Hold **Command** for image tools instead.

Selecting files and pressing Shift without dragging does not open the wheel. You do not need to click Sift's icon before dragging. The menu-bar icon opens its menu; choose **Open format wheel** to open a wheel manually. **Escape** or clicking outside dismisses an idle manually opened wheel. An active editor or conversion keeps its recovery controls.

If dragging still does nothing, check **Settings → Drag shortcuts**. A permission message means macOS has not granted access to this installed copy. Use **Open shortcut access…**, approve Sift and quit/reopen it. An unsigned app update may require granting access to the new copy again. If Sift already looks enabled after an update, switch only Sift off and back on in Input Monitoring, approve the macOS prompt, then quit/reopen it.

If that still leaves the permission message in Sift, select Sift's old entry in Input Monitoring and remove it with **−**. Click **+**, choose **Applications → Sift**, enable it, then choose **Quit & Reopen**. This replaces the permission entry for the old unsigned copy. Leave the other applications in the list unchanged.

You can use **Convert files…** without granting Input Monitoring. Launch at login is also optional. Enable it in Sift's settings; macOS may ask you to approve it in **General → Login Items**.

## 3. Install on Windows 11

1. Open Downloads and double-click `Sift-<version>-windows-x64-setup.exe`.
2. Let the installer finish. It installs for your current Windows account and starts Sift automatically.
3. Look beside the clock in the notification area. Click the hidden-icons arrow if Sift is not visible.
4. Open Sift's icon menu. You can also find **Sift** in Start to open it again.

The installer does not ask for administrator access, install a Windows service or require a console window. It creates a Start shortcut; a Desktop shortcut is not created. The usual application folder is `%LOCALAPPDATA%\Programs\sift-desktop`.

### If Windows warns about the installer

This prerelease has no Microsoft-trusted publisher signature. SmartScreen may show **Windows protected your PC** or an unknown-publisher warning. If you downloaded this repository's release asset and trust it, **More info → Run anyway** may be available. A work/school policy or Smart App Control can block an unsigned application without offering that choice; use an allowed device or wait for a signed release. Do not switch off Windows security to install Sift.

### Optional: drag shortcuts and startup

Drag a file from Explorer, hold **Shift**, then drop it onto a format. Hold **Alt** for image tools. Enable **Launch at login** in Sift's settings if you want it to start with Windows. It is off by default.

## 4. Convert your first file

1. Click Sift's menu-bar/notification-area icon → **Convert files…**.
2. Choose a small image, such as a PNG.
3. Choose a different format on the wheel, such as JPG.
4. Find the converted file beside the original. Sift keeps the original and adds a numbered suffix if the output name already exists.

Use **Current jobs…** to find results, see errors or cancel work. Closing a window leaves Sift running. Use **Quit Sift** in its icon menu to exit completely. The keyboard shortcut **Command+Option+Space** on Mac or **Ctrl+Alt+Space** on Windows opens the wheel.

If a file is in a protected or read-only folder, select a writable output folder in Settings and try again. Files stored in the cloud must be downloaded to your computer before conversion.

## Update

There is no automatic updater. Download the newer installer from [Releases](https://github.com/Yash789k/Sift/releases), then **Quit Sift** before updating.

- **Mac:** open the new DMG, drag Sift into Applications and choose Replace, then reopen it. Keep the same application name and location.
- **Windows:** run the newer setup EXE under the same Windows account, then reopen Sift if necessary.

Your converted files and settings are retained. Launch-at-login remains an opt-in setting.

## Uninstall

- **Mac:** turn off Launch at login in Sift, quit it, then move Sift from Applications to Trash. If Sift no longer opens, also check macOS Login Items for an old entry.
- **Windows:** open **Settings → Apps → Installed apps → Sift → Uninstall**. This removes the app and its Sift startup registration.

Converted files are kept. Preferences, recent output records and local logs are also retained. If you deliberately want to reset those, remove only `%APPDATA%\Sift` on Windows or `~/Library/Application Support/Sift` on Mac after quitting/uninstalling.

## Report a problem

Open a [GitHub issue](https://github.com/Yash789k/Sift/issues) with your Sift version, OS version, chip/system type, the exact message and steps to reproduce. Use non-sensitive sample files. Review logs and screenshots before sharing them; they can contain file locations. Never include passwords or signing keys.
