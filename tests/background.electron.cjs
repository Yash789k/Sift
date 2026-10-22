'use strict';
// Run with Electron, not node --test. Exercises the real main/preload/renderer
// and worker. Only native file pickers and Quit choices are controlled fixtures.
const { app, BrowserWindow, Tray, dialog } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { promisify } = require('node:util'), { execFile } = require('node:child_process');
const root = path.resolve(process.env.SIFT_APP_ROOT || path.join(__dirname, '..'));
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-desktop-qa-'));
const profile = path.join(folder, 'profile'), out = path.join(folder, 'outputs');
fs.mkdirSync(profile); fs.mkdirSync(out);
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({outputDir:out, gestureEnabled:false, history:[], radialVersion:3}));
app.setPath('userData', profile);
let menu, pickerPaths = [], dialogChoice = 0, dialogCalls = 0, finalQuitExpected = false;
let startupNeedsReset = false;
const evidence = {platform:process.platform, packaged:app.isPackaged, nativeDragSimulated:false, checks:[], errors:[], outputs:[]};
const setMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function(value) { menu = value; return setMenu.call(this, value); };
dialog.showOpenDialog = async () => ({canceled:!pickerPaths.length, filePaths:pickerPaths});
dialog.showMessageBox = async () => { dialogCalls++; return {response:dialogChoice}; };
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', (_event, details) => {
    if (details?.level === 'error') evidence.errors.push(details.message);
  });
  window.webContents.on('render-process-gone', (_event, details) => evidence.errors.push(details.reason));
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(30); }
  throw new Error(`Timed out: ${message}`);
}
function item(prefix) { const value = menu?.items.find(entry => entry.label?.startsWith(prefix)); assert.ok(value, `Missing tray item ${prefix}`); return value; }
const js = async (window, code) => {
  const result = await window.webContents.executeJavaScript(`(async()=>{try{return await (${code})}catch(error){return {__qaError:error.stack}}})()`);
  if (result?.__qaError) throw new Error(`${code}\n${result.__qaError}`);
  return result;
};
const windows = () => BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
const wheel = () => windows().find(window => /[\\/]index\.html/.test(window.webContents.getURL()));
const utility = () => windows().find(window => /[\\/]utility\.html/.test(window.webContents.getURL()));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function shot(window, name) {
  const file = path.join(folder, `${name}.png`);
  await pause(180); fs.writeFileSync(file, (await window.webContents.capturePage()).toPNG());
  return file;
}
require(path.join(root, 'src', 'main.cjs'));
app.on('will-quit', () => {
  if (finalQuitExpected) {
    assert.ok(!fs.readdirSync(out).some(file => file.startsWith('.sift-')), 'No temporary files after quit cleanup');
    evidence.checks.push('Explicit Quit during a media job cancels, awaits engine cleanup, and exits.');
    evidence.pass = evidence.errors.length === 0;
    evidence.workspace = folder;
    const destination = process.env.SIFT_QA_RESULT || path.join(folder, 'result.json');
    fs.mkdirSync(path.dirname(destination), {recursive:true}); fs.writeFileSync(destination, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({pass:evidence.pass, checks:evidence.checks, result:destination, workspace:folder}));
  }
});
app.whenReady().then(async () => {
  try {
    await until(() => menu, 'tray creation');
    await pause(250);
    assert.equal(windows().length, 0, 'Normal startup must create no BrowserWindow');
    assert.equal(Object.keys(require.cache).some(file => /[\\/]engine\.cjs$/.test(file)), false, 'Main process must not load conversion engine');
    for (const label of ['Convert files', 'Current jobs', 'Open output folder', 'Settings', 'Launch at login', 'Quit']) item(label);
    evidence.checks.push('Silent launch creates no window and no engine in main; complete tray menu is available.');

    await item('Settings').click();
    await until(() => utility() && !utility().webContents.isLoadingMainFrame(), 'settings window');
    const panel = utility();
    await until(() => js(panel, 'Boolean(window.siftUtility) && !document.querySelector("#settings-view").hidden'), 'settings view');
    const initialSnapshot = await js(panel, 'siftUtility.snapshot()');
    assert.equal(initialSnapshot.state.outputDir, out);
    if (!app.isPackaged) assert.equal(initialSnapshot.startup.supported, false);
    if (app.isPackaged && process.platform === 'win32' && process.env.SIFT_QA_STARTUP === '1') {
      assert.equal(initialSnapshot.startup.registered, false, 'Startup test requires no existing Sift registration');
      startupNeedsReset = true;
      await js(panel, 'siftUtility.action({action:"set-startup",enabled:true})');
      const enabled = await js(panel, 'siftUtility.snapshot()');
      assert.equal(enabled.startup.registered, true); assert.equal(enabled.startup.enabled, true);
      await js(panel, 'siftUtility.action({action:"set-startup",enabled:false})');
      assert.equal((await js(panel, 'siftUtility.snapshot()')).startup.registered, false);
      startupNeedsReset = false;
      evidence.checks.push('Packaged Windows startup toggle registers the actual executable, reads OS-enabled status, and removes its registration again.');
    }
    evidence.settingsScreenshot = await shot(panel, 'settings');
    panel.close(); await pause(100); assert.equal(panel.isVisible(), false);
    await item('Current jobs').click();
    await until(() => panel.isVisible(), 'reopen panel');
    assert.equal(utility(), panel);
    await until(() => js(panel, '!document.querySelector("#jobs-view").hidden'), 'jobs view');
    evidence.checks.push('Settings opens on request; close keeps utility alive; Current jobs reopens the same window.');

    const image = path.join(folder, 'Source.png');
    fs.copyFileSync(path.join(root, 'samples', 'Aurora.png'), image);
    const originalHash = hash(image); pickerPaths = [image];
    await item('Convert files').click();
    await until(() => wheel() && !wheel().webContents.isLoadingMainFrame(), 'wheel');
    const radial = wheel();
    await until(() => js(radial, 'files.length === 1 && Boolean(state.capabilities)'), 'chosen file reaches wheel');
    await js(radial, 'document.querySelector(".wedge[data-id=webp]").dispatchEvent(new MouseEvent("click",{bubbles:true}))');
    await until(() => js(panel, 'siftUtility.snapshot().then(s => s.jobs.some(j => j.status === "completed"))'), 'conversion');
    let current = await js(panel, 'siftUtility.snapshot()');
    const result = current.jobs.find(job => job.status === 'completed').results[0];
    const sharp = require(path.join(root, 'node_modules', 'sharp'));
    assert.equal((await sharp(result.path).metadata()).format, 'webp');
    assert.equal(hash(image), originalHash); evidence.outputs.push(result.path);
    evidence.wheelScreenshot = await shot(radial, 'wheel');
    evidence.checks.push('Tray Convert files feeds the real wheel; WEBP click runs worker and saves a decoded output with source hash unchanged.');
    await js(radial, 'document.querySelector("#wheel-switch").dispatchEvent(new MouseEvent("click",{bubbles:true}))');
    assert.equal(await js(radial, 'wheelKind'), 'tools');
    evidence.toolsScreenshot = await shot(radial, 'tools');
    await js(radial, 'document.querySelector(".wedge[data-id=crop]").dispatchEvent(new MouseEvent("click",{bubbles:true}))');
    await until(() => js(radial, 'mode === "editor" && document.querySelector("#preview-image").naturalWidth > 0'), 'crop preview');
    evidence.cropScreenshot = await shot(radial, 'crop');
    await js(radial, 'document.querySelector("#apply-editor").click()');
    await until(() => js(panel, 'siftUtility.snapshot().then(s => s.jobs.some(j => j.operation === "crop" && j.status === "completed"))'), 'crop job');
    radial.close(); assert.equal(radial.isVisible(), false);
    current = await js(panel, 'siftUtility.snapshot()');
    evidence.outputs.push(current.jobs.find(job => job.operation === 'crop').results[0].path);
    evidence.checks.push('Tools/Crop remains functional through worker-backed preview and save; closing wheel does not quit.');

    await js(radial, `sift.convert({paths:[${JSON.stringify(image)}],format:'webp'})`);
    current = await js(panel, 'siftUtility.snapshot()');
    const webps = current.jobs.filter(job => job.operation === 'webp');
    assert.equal(webps.length, 2); assert.notEqual(webps[0].results[0].path, webps[1].results[0].path);
    const broken = path.join(folder, 'Broken.png'); fs.writeFileSync(broken, 'This is deliberately not an image.');
    await js(radial, `sift.convert({paths:[${JSON.stringify(broken)}],format:'webp'}).catch(e => e.message)`);
    current = await js(panel, 'siftUtility.snapshot()');
    assert.ok(current.jobs.some(job => job.status === 'failed' || job.status === 'completed-with-errors'));
    evidence.checks.push('Intentional repeat creates a separate collision-safe output; damaged input appears as an understandable failed job.');

    const ffmpeg = require(path.join(root, 'node_modules', 'ffmpeg-static'));
    const clip = path.join(folder, 'Motion.mp4');
    await promisify(execFile)(ffmpeg, ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=1280x720:rate=12','-t','20','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',clip], {windowsHide:true});
    await js(radial, `(window.pendingConversion = sift.convert({paths:[${JSON.stringify(clip)}],format:'webm'}).catch(e=>({error:e.message})), undefined)`);
    await until(() => js(panel, 'siftUtility.snapshot().then(s=>s.jobs.some(j=>j.status==="running"))'), 'long job');
    await js(radial, `(window.duplicateConversion = sift.convert({paths:[${JSON.stringify(clip)}],format:'webm'}).catch(e=>({error:e.message})), undefined)`);
    assert.equal((await js(panel, 'siftUtility.snapshot()')).jobs.filter(job => job.status === 'running').length, 1);
    const conflict = await js(radial, `sift.convert({paths:[${JSON.stringify(clip)}],format:'mp4'}).then(()=>false,e=>e.message)`);
    assert.match(conflict, /already|running|busy/i);
    await item('Current jobs').click(); evidence.jobsScreenshot = await shot(panel, 'jobs');
    dialogChoice = 0; item('Quit').click();
    await until(() => dialogCalls > 0, 'quit choice'); await pause(50);
    assert.ok(dialogCalls > 0); assert.equal(app.isReady(), true);
    current = await js(panel, 'siftUtility.snapshot()');
    assert.ok(current.jobs.some(job => job.status === 'running'));
    evidence.checks.push('Identical active requests coalesce; conflicting work is rejected; Keep running preserves the active conversion.');
    finalQuitExpected = true; dialogChoice = 1;
    await item('Quit').click();
  } catch (error) {
    if (startupNeedsReset) app.setLoginItemSettings({openAtLogin:false, path:process.execPath, args:['--background'], name:'org.siftconverter.desktop'});
    evidence.pass = false; evidence.errors.push(error.stack);
    const destination = process.env.SIFT_QA_RESULT || path.join(folder, 'result.json');
    fs.mkdirSync(path.dirname(destination), {recursive:true}); fs.writeFileSync(destination, JSON.stringify(evidence, null, 2));
    console.error(error.stack); app.exit(1);
  }
});
