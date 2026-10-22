'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createStartupSettings } = require('../src/startup-settings.cjs');
function fixture(platform, initial, extra = {}) {
  let actual = initial; const reads = [], writes = [];
  const app = { isPackaged: true, getLoginItemSettings: options => { reads.push(options); return actual; },
    setLoginItemSettings: options => writes.push(options), ...extra };
  return { controller: createStartupSettings({ app, platform, executable: 'C:\\Apps\\Sift\\Sift.exe', systemVersion: '14.0' }), reads, writes, update: value => { actual = value; } };
}
test('development never reads or writes a login registration', () => {
  const { controller, reads, writes } = fixture('win32', {}, { isPackaged: false });
  assert.equal(controller.read().supported, false); assert.throws(() => controller.set(true), /packaged/);
  assert.deepEqual(reads, []); assert.deepEqual(writes, []);
});
test('Windows distinguishes registration from Task Manager approval and refreshes OS state', () => {
  const enabled = { openAtLogin: true, executableWillLaunchAtLogin: true,
    launchItems: [{ name: 'org.siftconverter.desktop', path: 'C:\\Apps\\Sift\\Sift.exe', scope: 'user', args: [], enabled: true }] };
  const f = fixture('win32', enabled); assert.equal(f.controller.read().status, 'enabled');
  f.update({ ...enabled, executableWillLaunchAtLogin: false, launchItems: [{ ...enabled.launchItems[0], enabled: false }] });
  assert.equal(f.controller.read().registered, true); assert.equal(f.controller.read().enabled, false); assert.equal(f.controller.read().status, 'disabled');
  f.update({ openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] });
  assert.equal(f.controller.read().status, 'not-registered');
});
test('unrelated Windows executable paths or machine entries cannot imply Sift startup approval', () => {
  for (const entry of [{ name: 'org.siftconverter.desktop', path: 'C:\\Different\\Sift.exe', scope: 'user', args: [], enabled: true },
    { name: 'org.siftconverter.desktop', path: 'C:\\Apps\\Sift\\Sift.exe', scope: 'machine', args: [], enabled: true },
    { name: 'DifferentApp', path: 'C:\\Apps\\Sift\\Sift.exe', scope: 'user', args: [], enabled: true }]) {
    const f = fixture('win32', { openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [entry] });
    assert.equal(f.controller.read().enabled, false);
  }
});
test('Windows exact-command mismatch remains disabled despite an approved matching executable', () => {
  const f = fixture('win32', { openAtLogin: false, executableWillLaunchAtLogin: true,
    launchItems: [{ name: 'org.siftconverter.desktop', path: 'C:\\Apps\\Sift\\Sift.exe', scope: 'user', args: [], enabled: true }] });
  assert.equal(f.controller.read().registered, false); assert.equal(f.controller.read().enabled, false);
});
test('Windows lookup quotes a stable executable path containing spaces', () => {
  let queried;
  const controller = createStartupSettings({ platform: 'win32', executable: 'C:\\Program Files\\Sift\\Sift.exe',
    app: { isPackaged: true, getLoginItemSettings: value => { queried = value; return {}; } } });
  controller.read(); assert.equal(queried.path, '"C:\\Program Files\\Sift\\Sift.exe"');
});
test('Windows toggles only the stable current-app registration and reads actual result', () => {
  const f = fixture('win32', { openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] });
  assert.equal(f.controller.set(true).enabled, false);
  assert.deepEqual(f.writes[0], { path: 'C:\\Apps\\Sift\\Sift.exe', args: ['--background'], openAtLogin: true, enabled: true, name: 'org.siftconverter.desktop' });
  assert.deepEqual(f.reads[0], { path: '"C:\\Apps\\Sift\\Sift.exe"', args: ['--background'] });
  f.controller.set(false); assert.equal(f.writes[1].openAtLogin, false); assert.equal(f.writes[1].enabled, false);
});
test('macOS reports every SMAppService status without optimistic preference state', () => {
  for (const status of ['not-registered', 'enabled', 'requires-approval', 'not-found']) {
    const f = fixture('darwin', { status, openAtLogin: status === 'enabled' }); const result = f.controller.read();
    assert.equal(result.enabled, status === 'enabled'); assert.equal(result.registered, ['enabled', 'requires-approval'].includes(status));
    assert.equal(result.status, status); assert.deepEqual(f.reads[0], { type: 'mainAppService' });
  }
  const f = fixture('darwin', { status: 'requires-approval' });
  assert.equal(f.controller.set(true).enabled, false); assert.deepEqual(f.writes[0], { type: 'mainAppService', openAtLogin: true });
});
test('OS query failures are unavailable states rather than a false success', () => {
  const f = fixture('darwin', {}, { getLoginItemSettings: () => { throw new Error('unavailable'); } });
  const result = f.controller.read(); assert.equal(result.status, 'error'); assert.equal(result.supported, false); assert.equal(result.enabled, false);
});
