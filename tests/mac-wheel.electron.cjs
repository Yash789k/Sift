'use strict';
// Native Electron window lifecycle checks. Finder dragging is separately
// exercised on a Mac with Input Monitoring enabled; no file drag is claimed here.
const { app, BrowserWindow, Tray, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
if (process.platform !== 'darwin') { console.log('Mac-only window checks skipped'); app.exit(0); }
else {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-mac-window-test-'));
  app.setPath('userData', profile);
  let menu, tray, gesture;
  const setMenu = Tray.prototype.setContextMenu;
  Tray.prototype.setContextMenu = function(value) { menu = value; tray = this; return setMenu.call(this, value); };
  require('../src/global-gesture.cjs').startGlobalGesture = callbacks => {
    gesture = callbacks; const stop = () => { stop.available = false; }; stop.available = true; return stop;
  };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check, label) {
    const end = Date.now() + 8000;
    while (Date.now() < end) { if (await check()) return; await pause(30); }
    throw new Error(`Timed out: ${label}`);
  }
  const windows = () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
  const wheel = () => windows().find(w => w.webContents.getURL().endsWith('/index.html'));
  const utility = () => windows().find(w => w.webContents.getURL().endsWith('/utility.html'));
  const item = label => menu.items.find(i => i.label.startsWith(label));
  const checks = [];
  require('../src/main.cjs');
  app.whenReady().then(async () => {
    try {
      await until(() => menu && gesture, 'startup');
      assert.equal(windows().length, 0);
      tray.emit('click'); await pause(150);
      assert.equal(windows().length, 0, 'Mac status item click must only open its assigned menu');
      checks.push('Quiet startup and menu-bar click do not create a wheel behind the menu.');
      item('Open format wheel').click();
      await until(() => wheel()?.isVisible() && wheel().isFocused(), 'focused manual wheel');
      const radial = wheel();
      await until(() => radial.webContents.executeJavaScript('Boolean(window.sift) && Boolean(state.capabilities)'), 'renderer ready');
      radial.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      radial.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await until(() => !radial.isVisible(), 'Escape dismissal');
      checks.push('Explicitly opened wheel receives keyboard focus and Escape dismisses it.');
      item('Open format wheel').click();
      await until(() => radial.isVisible() && radial.isFocused(), 'wheel reopened');
      item('Settings').click();
      await until(() => utility()?.isFocused() && !radial.isVisible(), 'outside focus dismisses wheel');
      checks.push('Moving focus away dismisses the idle manual wheel.');
      item('Open format wheel').click();
      await until(() => radial.isVisible() && radial.isFocused(), 'wheel for editor');
      await radial.webContents.executeJavaScript('sift.window({action:"editor",tool:"crop"})');
      utility().focus(); await pause(150);
      assert.equal(radial.isVisible(), true, 'An editor must retain its state when focus leaves');
      await radial.webContents.executeJavaScript('sift.window("hide")');
      checks.push('Editor state is retained when focus moves elsewhere.');
      const area = screen.getPrimaryDisplay().workArea;
      const center = { x: Math.floor(area.x + area.width / 2), y: Math.floor(area.y + area.height / 2) };
      for (const point of [center, { x: center.x + 20, y: center.y + 20 }]) {
        assert.equal(gesture.onTrigger(point), true);
        await until(() => radial.isVisible(), 'drag palette');
        const bounds = radial.getBounds();
        assert.equal(bounds.x + bounds.width / 2, point.x);
        assert.equal(bounds.y + bounds.height / 2, point.y);
        assert.equal(radial.isFocused(), false, 'Drag palette must not take keyboard focus from the drag source');
        gesture.onRelease(); await until(() => !radial.isVisible(), 'drag release dismissal');
      }
      checks.push('Drag activation uses each new pointer position without stealing focus; release hides the palette.');
      console.log(JSON.stringify({ pass: true, checks }));
      await fs.promises.rm(profile, { recursive: true, force: true });
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
