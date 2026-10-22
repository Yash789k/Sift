'use strict';
// Run with Electron, not node --test. Exercises the real main/preload/renderer
// and worker. Native file pickers, Quit choices and the final OS reveal boundary
// are controlled fixtures; conversion, window lifecycle and reveal IPC are real.
const { app, BrowserWindow, Tray, dialog, shell } = require('electron');
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
const revealed = [];
shell.showItemInFolder = file => revealed.push(file);
const evidence = {platform:process.platform, packaged:app.isPackaged, nativeDragSimulated:false, checks:[], errors:[], outputs:[]};
const windowTimes = new WeakMap();
const setMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function(value) { menu = value; return setMenu.call(this, value); };
dialog.showOpenDialog = async () => ({canceled:!pickerPaths.length, filePaths:pickerPaths});
dialog.showMessageBox = async () => { dialogCalls++; return {response:dialogChoice}; };
app.on('browser-window-created', (_event, window) => {
  const times = {}; windowTimes.set(window, times);
  window.on('show', () => { times.shown = performance.now(); });
  window.on('closed', () => { times.closed = performance.now(); });
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
const toast = () => windows().find(window => /[\\/]success-toast\.html/.test(window.webContents.getURL()));
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
    const audio = await js(radial, `(async()=>{
      const NativeContext=window.AudioContext;
      window.qaAudioContexts=[]; window.qaAudioStarts=0;
      window.AudioContext=class extends NativeContext {
        constructor(options){super(options);window.qaAudioContexts.push(this);}
      };
      const nativeStart=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){window.qaAudioStarts++;return nativeStart.apply(this,args);};
      const probe=SiftWheelSound.create();
      const started=performance.now();
      const initialPlayed=await probe.hover('first-hover-without-click');
      const initialElapsed=performance.now()-started;
      let played=initialPlayed;
      // A cold OS audio service can take longer than the intentional 500 ms
      // stale-feedback limit. Verify a fresh hover after that native resume,
      // without introducing a user click or weakening the timing unit tests.
      if(!initialPlayed && initialElapsed>500 && window.qaAudioContexts.at(-1)?.state==='running') {
        probe.reset(); played=await probe.hover('fresh-hover-without-click');
      }
      const result={played,state:window.qaAudioContexts.at(-1)?.state,initialPlayed,initialElapsed};
      probe.dispose(); return result;
    })()`);
    assert.equal(audio.state, 'running', 'Native audio must resume without a prior user click');
    assert.equal(audio.played, true, 'A fresh hover must play once native audio is ready');
    if (!audio.initialPlayed) assert.ok(audio.initialElapsed > 500, 'Only stale cold-start feedback may be dropped');
    evidence.audioInitialization = audio;
    await pause(100);
    const beforeHover = await js(radial, 'window.qaAudioStarts');
    await js(radial, 'document.querySelector(".wedge[data-id=webp]").dispatchEvent(new MouseEvent("mouseenter"))');
    await until(() => js(radial, `window.qaAudioStarts > ${beforeHover}`), 'wheel hover audio hook');
    const afterHover = await js(radial, 'window.qaAudioStarts');
    await pause(100);
    await js(radial, 'document.querySelector(".wedge[data-id=webp]").dispatchEvent(new MouseEvent("mouseenter"))');
    assert.equal(await js(radial, 'window.qaAudioStarts'), afterHover, 'Repeated entry on same target must not chatter');
    await js(radial, '(setBusy(true), document.querySelector(".wedge[data-id=jpeg]").dispatchEvent(new MouseEvent("mouseenter")), undefined)');
    assert.equal(await js(radial, 'window.qaAudioStarts'), afterHover, 'Busy wheel must not play feedback');
    await js(radial, '(setBusy(false), document.querySelector(".wedge[data-id=jpeg]").dispatchEvent(new MouseEvent("mouseleave")), undefined)');
    evidence.checks.push('Local soft click runs without a prior app click, responds to a wheel target and stays silent for repeated/busy events.');
    evidence.wheelScreenshot = await shot(radial, 'wheel');
    // Inspect actual composited alpha, including SVG filters/shadows. A visually
    // transparent fill alone does not prove the rim underneath is hollow.
    const sharp = require(path.join(root, 'node_modules', 'sharp'));
    const pixels = await sharp(evidence.wheelScreenshot).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const pixel = (x,y) => {
      const offset = (Math.round(y*pixels.info.height/400)*pixels.info.width+Math.round(x*pixels.info.width/400))*4;
      return [...pixels.data.subarray(offset, offset+4)];
    };
    evidence.glassPixels = {center:pixel(200,150), centerSide:pixel(160,160), outside:pixel(2,2), petal:pixel(200,100)};
    assert.ok(evidence.glassPixels.center[3] <= 8 && evidence.glassPixels.centerSide[3] <= 8, 'Empty center must be transparent through all layers');
    assert.equal(evidence.glassPixels.outside[3], 0);
    assert.ok(evidence.glassPixels.petal[3] > 20 && evidence.glassPixels.petal[3] < 230, 'Petal must show the desktop through real alpha');
    await js(radial, '(document.querySelector(".wedge[data-id=webp]").classList.add("hover"), undefined)');
    evidence.selectedScreenshot = await shot(radial, 'wheel-selected');
    await js(radial, '(document.querySelector(".wedge[data-id=webp]").classList.remove("hover"), undefined)');
    for (const [name,background] of [['dark','#171a22'],['light','#eef0f5'],['colorful','linear-gradient(135deg,#e65c9c,#6e75d5 45%,#54b5ae)']]) {
      await js(radial, `(document.body.style.background=${JSON.stringify(background)}, undefined)`);
      evidence[`${name}GlassScreenshot`] = await shot(radial, `wheel-${name}`);
    }
    await js(radial, '(document.body.style.background="", undefined)');
    evidence.checks.push('Real renderer has a hollow center, transparent exterior and translucent petals; glass reviewed on light, dark and colorful test backdrops.');
    await js(radial, `(()=>{
      document.querySelector(".wedge[data-id=webp]").dispatchEvent(new MouseEvent("click",{bubbles:true}));
      window.qaConflictingRequest=sift.convert({paths:[${JSON.stringify(image)}],format:'jpeg'}).then(()=>false,error=>error.message);
    })()`);
    assert.match(await js(radial, 'window.qaConflictingRequest'), /already|running|busy/i);
    await until(() => js(panel, 'siftUtility.snapshot().then(s => s.jobs.some(j => j.status === "completed"))'), 'conversion');
    let current = await js(panel, 'siftUtility.snapshot()');
    const result = current.jobs.find(job => job.status === 'completed').results[0];
    assert.equal((await sharp(result.path).metadata()).format, 'webp');
    assert.equal(hash(image), originalHash); evidence.outputs.push(result.path);
    await until(() => toast()?.isVisible(), 'conversion success toast');
    const firstToast = toast(), toastTimes = windowTimes.get(firstToast);
    assert.equal(radial.isVisible(), false, 'Successful conversion must hide wheel without Escape');
    assert.ok(firstToast.getBounds().height <= 100, 'Toast must not retain the wheel hitbox');
    assert.equal(await js(firstToast, 'document.querySelector("#success-show").disabled'), false);
    // Capture actual window events rather than spending the toast lifetime on
    // a screenshot, then querying an already-destroyed native window. Exact
    // two-second timing and Show at 1.7s are covered with a controlled clock in
    // completion-lifecycle.test.cjs; allow OS scheduling latency here.
    await until(() => firstToast.isDestroyed(), 'success toast expires', 5000);
    evidence.successVisibleMs = toastTimes.closed - toastTimes.shown;
    assert.ok(evidence.successVisibleMs >= 2000 && evidence.successVisibleMs < 5000,
      `Success toast lifetime: ${evidence.successVisibleMs} ms`);
    assert.equal(radial.isVisible(), false);
    evidence.checks.push('Tray Convert files feeds the real wheel; WEBP click runs worker and saves a decoded output with source hash unchanged.');
    evidence.checks.push('Successful conversion hides the wheel immediately; compact Show toast stays usable for two seconds and then disappears automatically.');
    evidence.checks.push('A rejected conflicting request does not invalidate the active conversion success/dismissal.');
    await item('Convert files').click();
    await until(() => radial.isVisible() && js(radial, 'files.length === 1'), 'reopen for tool');
    await js(radial, 'document.querySelector("#wheel-switch").dispatchEvent(new MouseEvent("click",{bubbles:true}))');
    assert.equal(await js(radial, 'wheelKind'), 'tools');
    evidence.toolsScreenshot = await shot(radial, 'tools');
    await js(radial, 'document.querySelector(".wedge[data-id=crop]").dispatchEvent(new MouseEvent("click",{bubbles:true}))');
    await until(() => js(radial, 'mode === "editor" && document.querySelector("#preview-image").naturalWidth > 0'), 'crop preview');
    evidence.cropScreenshot = await shot(radial, 'crop');
    await js(radial, 'document.querySelector("#apply-editor").click()');
    await until(() => js(panel, 'siftUtility.snapshot().then(s => s.jobs.some(j => j.operation === "crop" && j.status === "completed"))'), 'crop job');
    await until(() => toast()?.isVisible(), 'crop success toast');
    assert.equal(radial.isVisible(), false, 'Successful tool save must hide editor without X');
    current = await js(panel, 'siftUtility.snapshot()');
    const cropped = current.jobs.find(job => job.operation === 'crop').results[0].path;
    evidence.outputs.push(cropped);
    await js(toast(), 'document.querySelector("#success-show").click()');
    await until(() => revealed.includes(cropped), 'Show reveals successful output');
    await until(() => !toast()?.isVisible(), 'Show dismisses success toast');
    evidence.checks.push('Tools/Crop previews and saves in worker, closes editor automatically, and Show passes the actual saved output to the OS reveal boundary.');

    await item('Convert files').click();
    await until(() => radial.isVisible() && js(radial, 'files.length === 1'), 'reopen for compression');
    await js(radial, 'openEditor("compress")');
    await until(() => js(radial, 'mode === "editor" && document.querySelector("#preview-image").naturalWidth > 0'), 'compression preview');
    await js(radial, 'document.querySelector("#apply-editor").click()');
    await until(() => toast()?.isVisible(), 'compression success toast');
    assert.equal(radial.isVisible(), false);
    const compressionToast = toast();
    await item('Open format wheel').click();
    await until(() => radial.isVisible(), 'new wheel cancels old toast');
    assert.ok(compressionToast.isDestroyed() || !compressionToast.isVisible());
    await pause(2400);
    assert.equal(radial.isVisible(), true, 'An old success timer must never hide a new wheel');
    evidence.checks.push('Compression closes its editor; opening a new wheel cancels the previous toast and survives its old fade deadline.');
    radial.close(); assert.equal(radial.isVisible(), false);

    await js(radial, `sift.convert({paths:[${JSON.stringify(image)}],format:'webp'})`);
    current = await js(panel, 'siftUtility.snapshot()');
    const webps = current.jobs.filter(job => job.operation === 'webp');
    assert.equal(webps.length, 2); assert.notEqual(webps[0].results[0].path, webps[1].results[0].path);
    const broken = path.join(folder, 'Broken.png'); fs.writeFileSync(broken, 'This is deliberately not an image.');
    await item('Open format wheel').click();
    await until(() => radial.isVisible(), 'wheel for failure recovery');
    await js(radial, `(setFiles([{path:${JSON.stringify(broken)},name:'Broken.png',kind:'image',ext:'png',size:43}]), convert('webp'))`);
    current = await js(panel, 'siftUtility.snapshot()');
    assert.ok(current.jobs.some(job => job.status === 'failed' || job.status === 'completed-with-errors'));
    assert.equal(radial.isVisible(), true, 'Failed jobs must leave recovery controls visible');
    assert.equal(await js(radial, 'document.querySelector("#notice").classList.contains("hidden")'), false);
    assert.equal(Boolean(toast()?.isVisible()), false);
    await js(radial, `(setFiles([{path:${JSON.stringify(image)},kind:'image',ext:'png',size:1},{path:${JSON.stringify(broken)},kind:'image',ext:'png',size:43}]), convert('webp'))`);
    assert.equal(radial.isVisible(), true, 'Partial failure must not vanish as a full success');
    assert.match(await js(radial, 'document.querySelector("#notice-text").textContent'), /failed/i);
    assert.equal(Boolean(toast()?.isVisible()), false);
    evidence.checks.push('Intentional repeat creates a separate collision-safe output; damaged input appears as an understandable failed job.');
    evidence.checks.push('Failure and partial failure retain the wheel and readable recovery notice without a misleading success toast.');

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
