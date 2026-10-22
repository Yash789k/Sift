'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, screen, globalShortcut } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const { startGlobalGesture, requestMacGestureAccess } = require('./global-gesture.cjs');
const { startCapture, stopCapture } = require('./capture.cjs');
const { createWindowsDragContext } = require('./drag-context.cjs');
const { notifySavedOutputs } = require('./desktop-output.cjs');
const { createEngineService } = require('./engine-service.cjs');
const { createStartupSettings } = require('./startup-settings.cjs');
const { keepWindowInBackground, createQuitCoordinator } = require('./background-lifecycle.cjs');
const { createJobManager } = require('./job-manager.cjs');
const { createLocalLog } = require('./local-log.cjs');
const { createCompletionLifecycle } = require('./completion-lifecycle.cjs');
app.setName('Sift');
if (process.platform === 'win32') app.setAppUserModelId('org.siftconverter.desktop');
if (process.argv.includes('--demo')) {
  const profile = path.join(__dirname, '..', '.demo-data'); fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
}
const localLog = createLocalLog(path.join(app.getPath('userData'), 'logs'));
const log = localLog.log;
let win, wheelReady, utilityWin, utilityReady, utilityView = 'jobs', tray, stopGesture, releaseTimer, diagnosticTimer;
let quitting = false, quickMode = false, nativeDialogOpen = false, ingestionInProgress = false;
let retainedQuick = false, wheelKind = 'formats', editorOpen = false, wheelEpoch = 0;
let selectionProbe, dragContext, contextEpoch = 0, startupCache;
let successToast;
const completionJobs = new WeakMap();
let state = { outputDir: null, gestureEnabled: true, history: [], radialVersion: 3 };
const stateFile = path.join(app.getPath('userData'), 'settings.json');
const gestureLogFile = path.join(app.getPath('userData'), 'gesture-diagnostics.json');
const gestureEvents = [];
try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch {}
if (state.radialVersion !== 3) { state.outputDir = null; state.radialVersion = 3; }
if (typeof state.outputDir !== 'string' || !path.isAbsolute(state.outputDir)) state.outputDir = null;
state.gestureEnabled = state.gestureEnabled !== false;
state.history = Array.isArray(state.history) ? state.history.filter(i => i && typeof i.path === 'string' && typeof i.name === 'string' && Number.isFinite(i.size)).slice(0, 30) : [];
function saveState() {
  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); }
  catch (error) { log('settings-save-failed', { message: error.message }); }
}
function report(error) { log('operation-error', { message: error?.message || String(error) }); console.error(error); }
function runQuietly(promise) { Promise.resolve(promise).catch(report); }
function recordGesture(event) {
  gestureEvents.push({ time: new Date().toISOString(), ...event });
  if (gestureEvents.length > 40) gestureEvents.shift();
  clearTimeout(diagnosticTimer);
  diagnosticTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(gestureLogFile), { recursive: true }); fs.writeFileSync(gestureLogFile, JSON.stringify({ version: 3, events: gestureEvents }, null, 2)); }
    catch (error) { log('gesture-log-failed', { message: error.message }); }
  }, 100); diagnosticTimer.unref?.();
}
function send(type, value) { if (win && !win.isDestroyed()) win.webContents.send(type, value); }
const completion = createCompletionLifecycle({
  present: presentSuccessToast, hideSource: hideWindow,
  canPresent: () => !nativeDialogOpen && !quit.isStopping(),
  dismiss: token => {
    if (successToast?.token !== token) return;
    const previous = successToast.window; successToast = undefined;
    if (!previous.isDestroyed()) { previous.hide(); previous.destroy(); }
  },
  fade: token => { if (successToast?.token === token && !successToast.window.isDestroyed()) successToast.window.webContents.send('completion-fade', token); },
  reveal: async filePath => {
    if (showResult(filePath)) return true;
    nativeDialogOpen = true;
    try { await dialog.showMessageBox({ type: 'info', title: 'File unavailable', message: 'The saved file is no longer available.', detail: 'It may have been moved or deleted after Sift saved it.', buttons: ['OK'], noLink: true }); }
    finally { nativeDialogOpen = false; }
    return false;
  }, onError: report,
});
const engine = createEngineService({ logger: ({ event, ...details }) => log(event, details) });
let capabilities;
async function getCapabilities() { if (!capabilities) capabilities = await engine.request('getCapabilities'); return capabilities; }
const startup = createStartupSettings({ app, logger: log });
const jobs = createJobManager({
  submit: (operation, request, options) => engine.submit(operation, request, options), logger: log,
  onChange: () => {
    if (jobs.current?.progress) send('progress', jobs.current.progress);
    if (!jobs.current) retainedQuick = false;
    publishUtility(); rebuildTray();
  },
  onResults: async (results, label) => {
    const successes = results.filter(item => !item.error);
    if (successes.length) {
      state.history = [...successes.map(item => ({ ...item, time: Date.now(), format: label })), ...state.history].slice(0, 30);
      saveState();
      runQuietly(notifySavedOutputs(successes).then(summary => {
        if (summary?.notified) recordGesture({ event: 'desktop-outputs', notified: summary.notified, placed: summary.placed || 0, skipped: summary.skipped || 0 });
      }));
    }
    send('state', state);
  },
});
const quit = createQuitCoordinator({
  hasJobs: () => Boolean(jobs.current),
  confirm: async () => {
    const parent = [utilityWin, win].find(window => window && !window.isDestroyed() && window.isVisible());
    const options = { type: 'question', title: 'Quit Sift?', message: 'A file operation is still running.',
      detail: 'Keep Sift running, or cancel the operation and quit after its files and encoders finish cleaning up. Files already saved will be kept.',
      buttons: ['Keep running', 'Cancel operation and quit'], defaultId: 0, cancelId: 0, noLink: true };
    nativeDialogOpen = true;
    try { const answer = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)); return answer.response === 1; }
    finally { nativeDialogOpen = false; }
  },
  shutdown: async () => {
    completion.cancel();
    stopGesture?.(); selectionProbe?.stop(); clearTimeout(releaseTimer); stopCapture(); globalShortcut.unregisterAll();
    const settling = jobs.current?.promise;
    jobs.cancel(); await engine.shutdown();
    if (settling) await settling.catch(() => {});
  },
  finish: () => { quitting = true; app.quit(); }, logger: log,
});
let quitRequest;
function requestQuit() {
  if (!quitRequest) quitRequest = quit.request().catch(async error => {
    report(error);
    await dialog.showMessageBox({ type: 'error', title: 'Sift is still running', message: 'Sift could not finish cleaning up the operation.',
      detail: 'No new conversions will start. Files already saved are kept. You can inspect Current jobs and local logs, then choose Quit Sift again to retry cleanup.', buttons: ['OK'], noLink: true });
    return false;
  }).finally(() => { quitRequest = undefined; });
  return quitRequest;
}
function utilitySnapshot(refreshStartup = false) {
  if (refreshStartup || !startupCache) startupCache = startup.read();
  return { state: { outputDir: state.outputDir, gestureEnabled: state.gestureEnabled }, startup: startupCache,
    jobs: jobs.snapshot(), platform: process.platform, version: app.getVersion(), logPath: localLog.path, gestureAvailable: stopGesture?.available ?? false };
}
function publishUtility(refreshStartup = false) {
  const snapshot = utilitySnapshot(refreshStartup);
  if (utilityWin && !utilityWin.isDestroyed()) utilityWin.webContents.send('utility-snapshot', snapshot);
  return snapshot;
}
function lockNavigation(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => log('renderer-exited', { reason: details.reason, exitCode: details.exitCode }));
}
function ensureWheel() {
  if (wheelReady && win && !win.isDestroyed()) return wheelReady;
  const created = new BrowserWindow({
    width: 400, height: 400, minWidth: 1, minHeight: 1, title: 'Sift', backgroundColor: '#00000000', icon: path.join(__dirname, 'icon.png'),
    frame: false, transparent: true, show: false, hasShadow: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  win = created; lockNavigation(created);
  keepWindowInBackground(created, { isQuitting: () => quitting, onHide: hideWindow });
  if (process.platform === 'darwin') {
    created.on('blur', () => {
      // A manually opened palette behaves like a popover. Finder retains focus
      // during native drags; editors, dialogs and in-flight work retain theirs.
      if (!quickMode && !editorOpen && !jobs.current && !nativeDialogOpen && !ingestionInProgress) hideWindow();
    });
  }
  created.on('closed', () => { if (win === created) { win = undefined; wheelReady = undefined; } });
  wheelReady = created.loadFile(path.join(__dirname, 'index.html')).then(() => created).catch(error => {
    if (win === created) { win = undefined; wheelReady = undefined; }
    if (!created.isDestroyed()) created.destroy(); throw error;
  });
  return wheelReady;
}
async function showUtility(view = 'jobs') {
  if (quit.isStopping()) return;
  utilityView = view === 'settings' ? 'settings' : 'jobs';
  if (!utilityReady || !utilityWin || utilityWin.isDestroyed()) {
    const created = new BrowserWindow({ width: 500, height: 640, minWidth: 480, minHeight: 520, title: 'Sift',
      backgroundColor: '#fff7ee', icon: path.join(__dirname, 'icon.png'), show: false, fullscreenable: false,
      webPreferences: { preload: path.join(__dirname, 'utility-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    utilityWin = created; lockNavigation(created);
    keepWindowInBackground(created, { isQuitting: () => quitting });
    created.on('closed', () => { if (utilityWin === created) { utilityWin = undefined; utilityReady = undefined; } });
    created.on('focus', () => { publishUtility(true); rebuildTray(); });
    utilityReady = created.loadFile(path.join(__dirname, 'utility.html')).then(() => created).catch(error => {
      if (utilityWin === created) { utilityWin = undefined; utilityReady = undefined; }
      if (!created.isDestroyed()) created.destroy(); throw error;
    });
  }
  const window = await utilityReady;
  if (quit.isStopping() || window.isDestroyed()) return;
  window.webContents.send('utility-view', { view: utilityView }); publishUtility(true);
  if (window.isMinimized()) window.restore();
  if (process.platform === 'darwin') app.focus({ steal: true });
  window.show(); window.focus();
}
async function warmDragContext(input) {
  const epoch = ++contextEpoch; dragContext = undefined;
  const started = performance.now();
  try {
    const paths = (input.files || await selectionProbe?.query(input.sourceWindow, input.sourceClass) || [])
      .filter(p => typeof p === 'string' && path.isAbsolute(p)).slice(0, 100);
    if (!paths.length || epoch !== contextEpoch) return;
    const rows = await Promise.all(paths.map(async p => {
      const extension = path.extname(p).slice(1).toLowerCase();
      const kind = extension === 'pdf' ? 'pdf' : /^(mp3|wav|m4a|flac|ogg|aac|aiff|wma)$/.test(extension) ? 'audio' :
        /^(mp4|mov|mkv|webm|avi|m4v|wmv)$/.test(extension) ? 'video' : 'image';
      return { kind, ext: extension, size: (await fs.promises.stat(p)).size };
    }));
    if (epoch !== contextEpoch) return;
    dragContext = { kind: rows.every(r => r.kind === rows[0].kind) ? rows[0].kind : 'mixed', ext: rows.every(r => r.ext === rows[0].ext) ? rows[0].ext : undefined, count: rows.length, size: rows.reduce((n, r) => n + r.size, 0) };
    if (quickMode && !editorOpen) send('mode', { mode: 'wheel', kind: wheelKind, context: dragContext, fresh: false });
    recordGesture({ event: 'drag-context', kind: dragContext.kind, count: dragContext.count, elapsedMs: Math.round(performance.now() - started) });
  } catch { /* Context is advisory; real drops are inspected separately. */ }
}
function boundsAt(point, width, height) {
  const cursor = point || screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  return { width, height, x: Math.round(Math.max(area.x, Math.min(cursor.x - width / 2, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(cursor.y - height / 2, area.y + area.height - height))) };
}
function showWheel({ point, kind = 'formats', manual = false, fresh = true, files } = {}) {
  if (quit.isStopping() || engine.snapshot().closing) return false;
  if (jobs.current || nativeDialogOpen || (ingestionInProgress && fresh)) { if (manual && jobs.current) runQuietly(showUtility('jobs')); return false; }
  completion.cancel();
  clearTimeout(releaseTimer); quickMode = !manual; retainedQuick = false; editorOpen = false; wheelKind = kind;
  const epoch = ++wheelEpoch;
  runQuietly(ensureWheel().then(window => {
    if (epoch !== wheelEpoch || quit.isStopping()) return;
    const bounds = boundsAt(point, 400, 400);
    window.setMinimumSize(1, 1); window.setBounds(bounds); window.setAlwaysOnTop(true, 'floating');
    send('mode', { mode: 'wheel', kind: wheelKind, fresh, ...(!manual && dragContext ? { context: dragContext } : {}), ...(files ? { files } : {}) });
    if (manual) {
      if (window.isMinimized()) window.restore();
      if (process.platform === 'darwin') app.focus({ steal: true });
      window.show();
      if (process.platform === 'darwin') window.focus();
    } else window.showInactive();
    window.setBounds(bounds); recordGesture({ event: 'wheel-shown', kind: wheelKind, visible: window.isVisible() });
  }));
  return true;
}
function showEditor({ tool, width = 390, height = 600 } = {}) {
  if (!win || win.isDestroyed() || quit.isStopping()) return;
  completion.cancel();
  clearTimeout(releaseTimer); quickMode = false; retainedQuick = true; editorOpen = true;
  const old = win.getBounds();
  const bounds = boundsAt({ x: old.x + old.width / 2, y: old.y + old.height / 2 },
    Math.max(360, Math.min(560, Number(width) || 390)), Math.max(420, Math.min(780, Number(height) || 600)));
  win.setBounds(bounds);
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.show();
  if (process.platform === 'darwin') win.focus();
  win.setBounds(bounds); recordGesture({ event: 'editor-shown', tool });
}
function hideWindow() { clearTimeout(releaseTimer); wheelEpoch++; quickMode = false; editorOpen = false; retainedQuick = false; if (win && !win.isDestroyed()) { send('visibility', { visible: false }); win.hide(); } }
async function presentSuccessToast(summary, token) {
  if (!completion.isCurrent(token) || quit.isStopping()) return;
  const previous = win && !win.isDestroyed() ? win.getBounds() : null;
  const point = previous ? { x: previous.x + previous.width / 2, y: previous.y + previous.height + 48 } : screen.getCursorScreenPoint();
  const bounds = boundsAt(point, 360, 76);
  const created = new BrowserWindow({ ...bounds, minWidth: 1, minHeight: 1, title: 'Sift · Saved', backgroundColor: '#00000000',
    frame: false, transparent: true, show: false, hasShadow: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'success-toast-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  successToast = { token, window: created, bounds }; lockNavigation(created);
  created.on('closed', () => { if (successToast?.window === created) successToast = undefined; });
  try {
    await created.loadFile(path.join(__dirname, 'success-toast.html'));
    if (!completion.isCurrent(token) || created.isDestroyed()) { if (!created.isDestroyed()) created.destroy(); return; }
    created.webContents.send('completion-present', { token, count: summary.count, name: summary.name, warning: summary.warning });
  } catch (error) { if (!created.isDestroyed()) created.destroy(); if (completion.isCurrent(token)) throw error; }
}
function completionSender(event, token) {
  return successToast?.token === token && completion.isCurrent(token) && !successToast.window.isDestroyed() &&
    event.sender === successToast.window.webContents && (!event.senderFrame || event.senderFrame === successToast.window.webContents.mainFrame);
}
ipcMain.handle('completion-ready', (event, token) => {
  if (!completionSender(event, token)) return false;
  successToast.window.setAlwaysOnTop(true, 'floating'); successToast.window.showInactive(); successToast.window.setBounds(successToast.bounds);
  return completion.visible(token);
});
ipcMain.handle('completion-show', (event, token) => completionSender(event, token) ? completion.show(token) : false);
function setupGesture() {
  stopGesture?.(); stopGesture = undefined;
  if (!state.gestureEnabled || quit.isStopping() || engine.snapshot().closing) { recordGesture({ event: 'disabled' }); return; }
  stopGesture = startGlobalGesture({
    onDragStart: input => { runQuietly(ensureWheel()); void warmDragContext(input); },
    onTrigger: point => {
      if (jobs.current || nativeDialogOpen || ingestionInProgress || retainedQuick || editorOpen || quit.isStopping()) return false;
      const cursor = process.platform === 'win32' ? screen.screenToDipPoint(point) : point;
      return showWheel({ point: cursor, kind: point.kind || 'formats' });
    },
    onModeChange: kind => { if (!quickMode || editorOpen || jobs.current) return; wheelKind = kind; send('mode', { mode: 'wheel', kind, fresh: false }); },
    onRelease: () => { contextEpoch++; releaseTimer = setTimeout(() => { if (quickMode && !jobs.current && !retainedQuick && !ingestionInProgress) hideWindow(); }, 700); },
    onError: error => { recordGesture({ event: 'error', message: error.message }); log('gesture-error', { message: error.message }); send('gesture-status', { available: false, message: 'Drag shortcut unavailable. Click the tray icon to open the wheel.' }); },
    onDiagnostic: recordGesture,
  });
  recordGesture({ event: 'reader-started', available: stopGesture.available, platform: process.platform });
  send('gesture-status', { available: stopGesture.available });
  if (process.platform === 'darwin') publishUtility();
}
async function openOutput() {
  const directory = state.outputDir || (state.history[0] ? path.dirname(state.history[0].path) : app.getPath('downloads'));
  const error = await shell.openPath(directory); if (error) throw new Error(error); return true;
}
function showResult(filePath) {
  const known = state.history.some(item => item.path === filePath) || jobs.snapshot().some(job => job.results?.some(item => !item.error && item.path === filePath));
  if (!known || !fs.existsSync(filePath)) return false;
  shell.showItemInFolder(filePath); return true;
}
async function chooseFiles(parent) {
  if (jobs.current || nativeDialogOpen || quit.isStopping()) throw new Error('Finish the current operation before choosing more files.');
  nativeDialogOpen = true; clearTimeout(releaseTimer);
  try {
    const options = { title: 'Choose files', properties: ['openFile', 'multiSelections'] };
    const result = await (parent && !parent.isDestroyed() ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
    return result.canceled ? [] : await engine.request('inspectFiles', result.filePaths);
  } finally { nativeDialogOpen = false; }
}
async function convertFiles() {
  if (jobs.current) { await showUtility('jobs'); return; }
  const rows = await chooseFiles(utilityWin?.isVisible() ? utilityWin : undefined);
  if (rows.length) { utilityWin?.hide(); showWheel({ manual: true, files: rows }); }
}
async function chooseOutput(parent) {
  if (nativeDialogOpen || quit.isStopping()) throw new Error('Another dialog is already open.');
  nativeDialogOpen = true;
  try {
    const options = { title: 'Save converted files here', defaultPath: state.outputDir || app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] };
    const result = await (parent && !parent.isDestroyed() ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
    if (!result.canceled) { state.outputDir = result.filePaths[0]; saveState(); rebuildTray(); send('state', state); publishUtility(); }
    return state.outputDir;
  } finally { nativeDialogOpen = false; }
}
function setGesture(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Choose whether to enable drag shortcuts.');
  state.gestureEnabled = enabled; saveState(); setupGesture(); rebuildTray(); send('state', state); publishUtility(); return enabled;
}
function rebuildTray() {
  if (!tray || tray.isDestroyed()) return;
  const active = jobs.current, progress = active?.progress;
  const percent = progress?.total ? Math.min(100, Math.round((progress.index || 0) / progress.total * 100)) : null;
  const startupState = startupCache || startup.read();
  tray.setToolTip(active ? `Sift · ${active.status === 'cancelling' ? 'Cancelling' : 'Working'}${percent === null ? '' : ` ${percent}%`}` : 'Sift · Drag, Shift, drop');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Convert files…', enabled: !quit.isStopping() && !engine.snapshot().closing, click: () => runQuietly(convertFiles()) },
    { label: active ? `Current jobs — ${active.status === 'cancelling' ? 'cancelling' : percent === null ? 'working' : `${percent}%`}` : 'Current jobs…', click: () => runQuietly(showUtility('jobs')) },
    { label: 'Open output folder', click: () => runQuietly(openOutput()) },
    { type: 'separator' },
    { label: 'Open format wheel', click: () => showWheel({ manual: true }) },
    { label: 'Open tool wheel', click: () => showWheel({ manual: true, kind: 'tools' }) },
    { label: 'Settings…', click: () => runQuietly(showUtility('settings')) },
    ...(process.platform === 'darwin' && state.gestureEnabled && !stopGesture?.available
      ? [{ label: 'Enable drag shortcuts…', click: () => runQuietly(openMacShortcutAccess()) }] : []),
    { label: startupState.status === 'requires-approval' ? 'Launch at login — approval required' : 'Launch at login', type: 'checkbox', checked: startupState.enabled || startupState.status === 'requires-approval',
      enabled: startupState.supported, click: item => { try { startupCache = startup.set(item.checked); publishUtility(); rebuildTray(); } catch (error) { report(error); runQuietly(showUtility('settings')); } } },
    { type: 'separator' }, { label: 'Quit Sift', click: () => runQuietly(requestQuit()) },
  ]));
}
async function handleLaunchArguments(args) {
  if (args.includes('--stop-capture')) { stopCapture(); return; }
  const index = args.indexOf('--capture-dir');
  if (index >= 0) {
    const directory = args[index + 1], secondsIndex = args.indexOf('--capture-seconds');
    if (typeof directory === 'string' && path.isAbsolute(directory)) {
      const window = await ensureWheel(); showWheel({ manual: true });
      await startCapture(window, directory, secondsIndex >= 0 ? Number(args[secondsIndex + 1]) : 120);
    } return;
  }
  if (args.includes('--show-settings')) { await showUtility('settings'); return; }
  if (args.includes('--show-jobs')) { await showUtility('jobs'); return; }
  if (args.includes('--show-wheel')) showWheel({ manual: true });
  // Normal launches, including login and repeat launches, stay in the tray.
}
function validatePaths(paths, min = 1) {
  if (!Array.isArray(paths) || paths.length < min || paths.length > 100 || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw new Error('Choose 1–100 local files.');
}
function runJob(request, operation, label) {
  validatePaths(request?.paths); if (quit.isStopping()) throw new Error('Sift is finishing shutdown.');
  clearTimeout(releaseTimer); retainedQuick = true;
  const pending = jobs.run(operation, { ...request, outputDir: state.outputDir }, label);
  // Conflicting submissions are rejected by the job manager. They must not
  // invalidate the accepted job's completion or restart a duplicate's timer.
  if (pending !== jobs.current?.promise) return pending;
  if (!completionJobs.has(pending)) {
    const token = completion.begin(), job = jobs.current;
    const observed = pending.then(results => {
      completion.complete(token, results, { cancelled: job?.status !== 'completed' || quit.isStopping() });
      return results;
    });
    completionJobs.set(pending, observed);
  }
  return completionJobs.get(pending);
}
function handle(channel, callback, scope = 'wheel') {
  ipcMain.handle(channel, (event, ...args) => {
    const allowed = scope === 'utility' ? utilityWin : win;
    if (!allowed || allowed.isDestroyed() || event.sender !== allowed.webContents || (event.senderFrame && event.senderFrame !== allowed.webContents.mainFrame)) throw new Error('This request is not from a Sift window.');
    if (quit.isStopping() && !['state', 'utility-snapshot'].includes(channel)) throw new Error('Sift is finishing shutdown.');
    return callback(event, ...args);
  });
}
async function openMacShortcutAccess() {
  if (process.platform !== 'darwin') return;
  await showUtility('settings');
  requestMacGestureAccess(); setupGesture(); rebuildTray();
  if (!stopGesture?.available) await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
}
handle('state', async () => ({ ...state, platform: process.platform, capabilities: await getCapabilities(), gestureAvailable: stopGesture?.available ?? false }));
handle('ingestion-begin', () => { if (jobs.current) throw new Error('A file operation is already running.'); completion.cancel(); ingestionInProgress = true; clearTimeout(releaseTimer); });
handle('ingestion-end', () => { ingestionInProgress = false; retainedQuick = false; });
handle('choose-files', () => chooseFiles(win));
handle('sample', () => engine.request('inspectFiles', [path.join(__dirname, '..', 'samples', 'Aurora.png')]));
handle('preview', (_event, filePath) => { validatePaths([filePath]); return engine.request('previewFile', filePath); });
handle('inspect', (_event, paths) => { validatePaths(paths, 0); clearTimeout(releaseTimer); retainedQuick = true; return engine.request('inspectFiles', paths); });
handle('inspect-tools', (_event, paths) => { validatePaths(Array.isArray(paths) ? paths : [paths]); return engine.request('inspectTools', paths); });
handle('tool-preview', (_event, request) => { validatePaths([request?.path]); return engine.request('previewTool', request); });
handle('run-tool', (_event, request) => { if (typeof request?.tool !== 'string') throw new Error('Choose a tool.'); return runJob(request, 'runTool', request.tool); });
handle('convert', (_event, request) => { if (typeof request?.format !== 'string' || request.format.length > 12) throw new Error('Choose an output format.'); return runJob(request, 'convert', request.format); });
handle('choose-output', () => chooseOutput(win));
handle('cancel', () => jobs.cancel());
handle('show-result', (_event, filePath) => showResult(filePath));
handle('open-output', openOutput);
handle('gesture', (_event, enabled) => setGesture(enabled));
handle('window', (_event, value) => {
  const request = typeof value === 'string' ? { action: value } : value || {};
  if (request.action === 'hide' || request.action === 'minimize') hideWindow();
  if (request.action === 'wheel' || request.action === 'expand') showWheel({ manual: true, kind: request.kind || wheelKind, fresh: false });
  if (request.action === 'editor') showEditor(request);
  if (request.action === 'quit') runQuietly(requestQuit());
});
handle('utility-snapshot', () => utilitySnapshot(true), 'utility');
handle('utility-action', async (_event, request) => {
  switch (request?.action) {
    case 'cancel-job': jobs.cancel(request.id); break;
    case 'set-startup': startupCache = startup.set(request.enabled); rebuildTray(); break;
    case 'set-gesture': setGesture(request.enabled); break;
    case 'gesture-access': await openMacShortcutAccess(); break;
    case 'choose-output': await chooseOutput(utilityWin); break;
    case 'reset-output': state.outputDir = null; saveState(); send('state', state); rebuildTray(); break;
    case 'open-output': await openOutput(); break;
    case 'show-result': if (!showResult(request.path)) throw new Error('The saved file is no longer available.'); break;
    case 'open-logs': { fs.mkdirSync(path.dirname(localLog.path), { recursive: true }); const error = await shell.openPath(path.dirname(localLog.path)); if (error) throw new Error(error); break; }
    case 'hide': utilityWin?.hide(); break;
    case 'quit': runQuietly(requestQuit()); break;
    case 'convert-files': await convertFiles(); break;
    default: throw new Error('Unknown Sift action.');
  }
  return publishUtility(true);
}, 'utility');
if (!app.requestSingleInstanceLock({ argv: process.argv })) app.quit();
else {
  app.on('second-instance', (_event, args, _directory, data) => {
    runQuietly(app.whenReady().then(() => handleLaunchArguments(Array.isArray(data?.argv) ? data.argv : args)));
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null);
    if (process.platform === 'win32') selectionProbe = createWindowsDragContext();
    startupCache = startup.read();
    const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    tray = new Tray(icon.resize({ width: 20, height: 20 })); rebuildTray();
    tray.on('click', () => {
      publishUtility(true); rebuildTray();
      // macOS opens the assigned menu on this same click. Opening the palette
      // here leaves it behind that menu without keyboard focus.
      if (process.platform !== 'darwin') showWheel({ manual: true });
    });
    tray.on('right-click', () => { publishUtility(true); rebuildTray(); });
    if (!globalShortcut.register('CommandOrControl+Alt+Space', () => showWheel({ manual: true }))) log('shortcut-unavailable');
    if (process.platform === 'darwin') app.dock?.hide();
    setupGesture(); rebuildTray();
    if (process.platform === 'darwin' && app.isPackaged && state.gestureEnabled && !stopGesture?.available && !state.gesturePermissionRequested) {
      state.gesturePermissionRequested = true; saveState();
      requestMacGestureAccess();
    }
    log('app-started', { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged });
    await handleLaunchArguments(process.argv);
  }).catch(report);
  app.on('before-quit', event => { if (quit.canExit()) return; event.preventDefault(); runQuietly(requestQuit()); });
}
app.on('window-all-closed', () => {});
process.on('unhandledRejection', error => report(error));
