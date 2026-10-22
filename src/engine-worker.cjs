'use strict';
const { parentPort } = require('node:worker_threads');
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
let active = null;
let closing = false;
const temporaryPattern = /^\.sift-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-z0-9]+$/i;
function temporary(file, present = true) {
  if (!active || typeof file !== 'string' || !path.isAbsolute(file) || !temporaryPattern.test(path.basename(file))) return false;
  parentPort.postMessage({ type: 'temporary', id: active.id, path: file, active: present });
  return true;
}

// These wrappers are local to this worker. They observe the existing engine's
// private temporary files without changing its publication or cleanup rules.
const writeFile = fs.writeFile, unlink = fs.unlink, copyFile = fs.copyFile;
fs.writeFile = function (file, ...args) { temporary(file); return writeFile.call(this, file, ...args); };
fs.unlink = async function (file) {
  try { const result = await unlink.call(this, file); temporary(file, false); return result; }
  catch (error) { if (error.code === 'ENOENT') temporary(file, false); throw error; }
};
fs.copyFile = async function (source, destination, ...args) {
  const result = await copyFile.call(this, source, destination, ...args);
  if (active && typeof source === 'string' && temporaryPattern.test(path.basename(source))) {
    // Observation must never turn an already published output into a failure.
    const stat = await fs.stat(destination).catch(() => null);
    parentPort.postMessage({ type: 'published', id: active.id, result: { source: active.source,
      path: destination, name: path.basename(destination), ...(stat ? { size: stat.size } : {}) } });
  }
  return result;
};
let sharpObserved = false;
function observeSharp() {
  if (sharpObserved) return;
  const sharp = require('sharp');
  const toFile = sharp.prototype.toFile;
  sharp.prototype.toFile = function (file, ...args) { temporary(file); return toFile.call(this, file, ...args); };
  sharpObserved = true;
}

// Observe child ownership before loading the existing engine. If this thread
// unexpectedly exits, the service can reap its media encoder without retrying a
// potentially published conversion. Normal cancellation stays inside engine.
const spawn = childProcess.spawn;
childProcess.spawn = function (...args) {
  if (Array.isArray(args[1])) for (const argument of args[1]) temporary(argument);
  const child = spawn.apply(this, args);
  const id = active?.id;
  if (child.pid && id) {
    parentPort.postMessage({ type: 'child', id, pid: child.pid, active: true });
    child.once('close', () => parentPort.postMessage({ type: 'child', id, pid: child.pid, active: false }));
  }
  return child;
};

function aborted() {
  const error = new Error('Conversion cancelled.'); error.name = 'AbortError'; error.code = 'ABORT_ERR'; return error;
}
function sendError(id, error) {
  parentPort.postMessage({ type: 'error', id, error: { name: error.name || 'Error', code: error.code,
    message: String(error.message || error).slice(0, 1000) } });
}
async function dispatch(operation, payload, progress, signal) {
  observeSharp();
  const engine = require('../engine.cjs');
  switch (operation) {
    case 'getCapabilities': return engine.getCapabilities();
    case 'inspectFiles': return engine.inspectFiles(payload);
    case 'previewFile': return engine.previewFile(payload);
    case 'convert': return engine.convert(payload, progress, signal);
    case 'inspectTools': return require('../tools-engine.cjs').inspectTools(payload);
    case 'previewTool': return require('../tools-engine.cjs').previewTool(payload);
    case 'runTool': return require('../tools-engine.cjs').runTool(payload, progress, signal);
    default: throw new Error('Unsupported file operation.');
  }
}
parentPort.on('message', async message => {
  if (message.type === 'cancel') {
    if (active?.id === message.id) active.controller.abort();
    return;
  }
  if (message.type === 'close') {
    closing = true;
    if (active) active.controller.abort(); else parentPort.close();
    return;
  }
  if (message.type !== 'run') return;
  if (active || closing) { sendError(message.id, new Error('The file worker is unavailable.')); return; }
  const controller = new AbortController();
  const control = new Int32Array(message.control);
  active = { id: message.id, controller, source: message.payload?.paths?.[0] };
  // The shared cancellation flag is observable even during synchronous JS/WASM
  // processing. Abort events still drive the engine's FFmpeg child cleanup.
  const signal = {
    get aborted() { return Atomics.load(control, 0) !== 0 || controller.signal.aborted; },
    addEventListener: (...args) => controller.signal.addEventListener(...args),
    removeEventListener: (...args) => controller.signal.removeEventListener(...args),
  };
  let sequence = 0;
  const progress = value => {
    if (value?.source && !(message.operation === 'convert' && message.payload?.format === 'pdf')) active.source = value.source;
    const previous = sequence++;
    parentPort.postMessage({ type: 'progress', id: message.id, sequence, value });
    // Bounded acknowledgement provides backpressure and lets cancellation from
    // a completion callback take effect before the next batch item is published.
    if (Atomics.load(control, 1) === previous) Atomics.wait(control, 1, previous, 150);
  };
  try {
    if (signal.aborted) throw aborted();
    const result = await dispatch(message.operation, message.payload, progress, signal);
    if (signal.aborted && !['convert', 'runTool'].includes(message.operation)) throw aborted();
    parentPort.postMessage({ type: 'result', id: message.id, result });
  } catch (error) { sendError(message.id, signal.aborted ? aborted() : error); }
  finally {
    active = null;
    if (closing) parentPort.close();
  }
});
parentPort.postMessage({ type: 'ready' });
