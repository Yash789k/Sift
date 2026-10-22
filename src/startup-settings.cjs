'use strict';
const path = require('node:path');
const STARTUP_NAME = 'org.siftconverter.desktop';

// Read OS-owned state every time. A saved preference cannot establish that a
// login item is registered or approved by the person using this computer.
function createStartupSettings({ app, platform = process.platform, executable = process.execPath,
  systemVersion = process.getSystemVersion?.() || '', logger = () => {} }) {
  const options = platform === 'darwin' ? { type: 'mainAppService' } : { path: executable, args: ['--background'] };
  // Electron 44 parses the Windows lookup path as a command line, unlike the
  // setter (which quotes it itself). Quote lookups to preserve spaces.
  const queryOptions = platform === 'win32' ? { ...options, path: `"${executable}"` } : options;
  function unsupported() {
    if (!app.isPackaged) return 'Launch at login is available in the packaged Sift app.';
    if (!['win32', 'darwin'].includes(platform)) return 'Launch at login is unavailable on this platform.';
    if (platform === 'darwin' && Number.parseInt(systemVersion, 10) < 13) return 'Launch at login requires macOS 13 or later.';
    return '';
  }
  function read() {
    const reason = unsupported();
    if (reason) return { supported: false, registered: false, enabled: false, status: 'unsupported', message: reason };
    try {
      const actual = app.getLoginItemSettings(queryOptions);
      if (platform === 'darwin') {
        const status = ['enabled', 'requires-approval', 'not-registered', 'not-found'].includes(actual.status) ? actual.status : 'unknown';
        return { supported: true, registered: status === 'enabled' || status === 'requires-approval', enabled: status === 'enabled', status,
          message: status === 'requires-approval' ? 'Allow Sift in System Settings → General → Login Items.' :
            status === 'not-found' ? 'macOS could not find this app. Keep Sift in Applications and try again.' :
            status === 'enabled' ? 'Sift will start quietly in the menu bar.' : status === 'unknown' ? 'macOS did not report the login item status.' : 'Sift will not start at login.' };
      }
      // openAtLogin checks the exact argv for the AppUserModelID entry. The
      // launchItems args omit switches in Electron 44, so do not recheck those.
      const matching = (actual.launchItems || []).filter(item => item.name === STARTUP_NAME && item.scope === 'user' &&
        typeof item.path === 'string' && path.win32.normalize(item.path).toLowerCase() === path.win32.normalize(executable).toLowerCase());
      const registered = actual.openAtLogin === true;
      const enabled = registered && actual.executableWillLaunchAtLogin === true && matching.some(item => item.enabled === true);
      return { supported: true, registered, enabled, status: enabled ? 'enabled' : registered ? 'disabled' : 'not-registered',
        message: enabled ? 'Sift will start quietly in the notification area.' : registered ? 'Sift is registered but disabled in Windows Startup apps.' : 'Sift will not start at login.' };
    } catch (error) {
      logger('startup-read-failed', { message: error.message });
      return { supported: false, registered: false, enabled: false, status: 'error', message: `Unable to read startup settings: ${error.message}` };
    }
  }
  function set(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Choose whether to launch at login.');
    const reason = unsupported(); if (reason) throw new Error(reason);
    app.setLoginItemSettings({ ...options, openAtLogin: enabled,
      ...(platform === 'win32' ? { name: STARTUP_NAME, enabled } : {}) });
    const result = read(); logger('startup-changed', { requested: enabled, status: result.status });
    return result;
  }
  return { read, set };
}
module.exports = { createStartupSettings };
