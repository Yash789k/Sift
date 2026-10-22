'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { Worker } = require('node:worker_threads');
const { stopOwnedChild } = require('./child-cleanup.cjs');
const OPERATIONS = new Set(['getCapabilities', 'inspectFiles', 'previewFile', 'convert', 'inspectTools', 'previewTool', 'runTool']);
const MUTATING = new Set(['convert', 'runTool']);
const PREVIEWS = new Set(['previewFile', 'previewTool']);

function serviceError(message, code, name = 'Error') { const error = new Error(message); error.code = code; error.name = name; return error; }
const abortError = () => serviceError('Conversion cancelled.', 'ABORT_ERR', 'AbortError');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
  return value;
}
function localPath(value) {
  if (typeof value !== 'string') return value;
  const resolved = path.resolve(value); return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function mutationKey(operation, payload) {
  const normalized = { ...payload, options: payload?.options || {} };
  if (Array.isArray(payload?.paths)) normalized.paths = [...new Set(payload.paths.map(localPath))];
  if (payload?.outputDir) normalized.outputDir = localPath(payload.outputDir); else delete normalized.outputDir;
  if (normalized.format) normalized.format = String(normalized.format).toLowerCase().replace(/^jpg$/, 'jpeg').replace(/^tif$/, 'tiff');
  return crypto.createHash('sha256').update(operation + JSON.stringify(stable(normalized))).digest('hex');
}
function previewKey(operation, payload) {
  return operation + ':' + localPath(operation === 'previewFile' ? payload : payload?.path || payload?.paths?.[0]) + ':' + (payload?.tool || '');
}

class EngineService {
  constructor({ idleMs = 30000, maxQueue = 64, logger, workerFactory = (filename, options) => new Worker(filename, options) } = {}) {
    this.idleMs = Math.max(10, Number(idleMs) || 30000); this.maxQueue = Math.max(1, Math.min(256, Number(maxQueue) || 64));
    this.logger = logger; this.workerFactory = workerFactory; this.worker = null; this.active = null;
    this.queue = []; this.jobs = new Map(); this.duplicates = new Map(); this.listeners = new Set(); this.events = [];
    this.children = new Set(); this.temporaries = new Set(); this.closing = false; this.retiring = false; this.recovering = false; this.sequence = 0;
    this.idleTimer = null; this.exitTimer = null; this.shutdownPromise = null; this.shutdownResolve = null; this.shutdownReject = null; this.cleanupFailure = null;
  }
  record(event, fields = {}) {
    // Deliberately omit paths, options, metadata and error messages from logs.
    const row = { time: new Date().toISOString(), event, ...fields }; this.events.push(row);
    if (this.events.length > 100) this.events.shift();
    try { this.logger?.({ ...row }); } catch {}
  }
  diagnostics() { return this.events.map(row => ({ ...row })); }
  snapshot() {
    return { running: this.active ? { id: this.active.id, operation: this.active.operation, status: this.active.cancelled ? 'cancelling' : 'running' } : null,
      queued: this.queue.length, workerActive: Boolean(this.worker), closing: this.closing, recovering: this.recovering, childProcesses: this.children.size };
  }
  onChange(callback) { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  changed() { for (const listener of this.listeners) { try { listener(this.snapshot()); } catch {} } }
  request(operation, payload, options) {
    try { return this.submit(operation, payload, options).promise; } catch (error) { return Promise.reject(error); }
  }
  submit(operation, payload, { onProgress, signal } = {}) {
    if (!OPERATIONS.has(operation)) throw serviceError('Unsupported file operation.', 'INVALID_OPERATION');
    if (this.cleanupFailure) throw this.cleanupFailure;
    if (this.closing) throw serviceError('Sift is shutting down.', 'SERVICE_CLOSED');
    if (signal?.aborted) return this.rejected(abortError());
    const key = MUTATING.has(operation) ? mutationKey(operation, payload) : null;
    const duplicate = key && this.duplicates.get(key);
    if (duplicate) {
      this.subscribe(duplicate, onProgress, signal); this.record('job-coalesced', { id: duplicate.id, operation }); return duplicate.handle;
    }
    const latest = PREVIEWS.has(operation) ? previewKey(operation, payload) : null;
    if (latest) for (const queued of [...this.queue]) if (queued.latest === latest) this.cancel(queued.id);
    if (this.queue.length >= this.maxQueue) return this.rejected(serviceError('Too many file requests are waiting. Try again shortly.', 'QUEUE_FULL'));
    const id = `job-${++this.sequence}`;
    let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Attaching this handler prevents a queued cancellation from becoming an
    // unhandled rejection before its caller awaits the original promise.
    promise.catch(() => {});
    const job = { id, operation, payload, key, latest, promise, resolve, reject, subscribers: [], control: new Int32Array(new SharedArrayBuffer(8)),
      cancelled: false, completed: new Map(), settled: false, startedAt: 0 };
    job.handle = { id, promise, cancel: () => this.cancel(id) };
    this.subscribe(job, onProgress, signal);
    this.jobs.set(id, job); if (key) this.duplicates.set(key, job);
    this.queue.push(job); this.record('job-queued', { id, operation }); this.changed(); this.drain(); return job.handle;
  }
  rejected(error) { const promise = Promise.reject(error); promise.catch(() => {}); return { id: null, promise, cancel: () => false }; }
  subscribe(job, onProgress, signal) {
    const abort = () => this.cancel(job.id); signal?.addEventListener('abort', abort, { once: true });
    job.subscribers.push({ onProgress, signal, abort });
  }
  cancel(id = this.active?.id) {
    const job = this.jobs.get(id); if (!job || job.settled || job.cancelled) return false;
    job.cancelled = true; Atomics.store(job.control, 0, 1);
    this.record('job-cancel-requested', { id: job.id, operation: job.operation });
    if (this.active === job) { try { this.worker?.postMessage({ type: 'cancel', id }); } catch {} this.changed(); }
    else { this.queue = this.queue.filter(row => row !== job); this.settle(job, abortError()); this.drain(); }
    return true;
  }
  ensureWorker() {
    if (this.worker) return;
    const worker = this.workerFactory(path.join(__dirname, 'engine-worker.cjs'), { name: 'sift-file-engine' });
    this.worker = worker; this.retiring = false;
    worker.on('message', message => { if (this.worker === worker) this.message(message); });
    worker.on('error', () => { this.record('worker-error'); });
    worker.on('exit', code => { if (this.worker === worker) void this.exited(code); });
    this.record('worker-started');
  }
  drain() {
    if (this.active || this.recovering || this.retiring || this.cleanupFailure) return;
    clearTimeout(this.idleTimer); this.idleTimer = null;
    if (this.closing) { this.retire(); return; }
    const job = this.queue.shift();
    if (!job) {
      this.worker?.unref();
      if (this.worker) { this.idleTimer = setTimeout(() => this.retire(), this.idleMs); this.idleTimer.unref?.(); }
      this.changed(); return;
    }
    this.active = job; job.startedAt = performance.now();
    try {
      this.ensureWorker(); this.worker.ref();
      this.worker.postMessage({ type: 'run', id: job.id, operation: job.operation, payload: job.payload, control: job.control.buffer });
      this.record('job-started', { id: job.id, operation: job.operation }); this.changed();
    } catch (error) { this.settle(job, serviceError('Unable to start the file worker.', 'WORKER_START_FAILED')); this.drain(); }
  }
  message(message) {
    const job = this.active;
    if (message.type === 'child') {
      if ((job?.id === message.id || !message.active) && Number.isInteger(message.pid) && message.pid > 0 && message.pid !== process.pid) {
        if (message.active) this.children.add(message.pid); else this.children.delete(message.pid);
        this.record(message.active ? 'child-started' : 'child-stopped'); this.changed();
      }
      return;
    }
    if (!job || message.id !== job.id) return;
    if (message.type === 'temporary') {
      if (this.ownedTemporary(job, message.path)) {
        if (message.active) this.temporaries.add(message.path); else this.temporaries.delete(message.path);
      }
    } else if (message.type === 'published') {
      if (message.result?.path && !message.result.error) job.completed.set(message.result.path, message.result);
    } else if (message.type === 'progress') {
      for (const row of Array.isArray(message.value?.result) ? message.value.result : [message.value?.result]) {
        if (row?.path && !row.error) job.completed.set(row.path, row);
      }
      try { for (const subscriber of job.subscribers) { try { subscriber.onProgress?.(message.value); } catch {} } }
      finally { Atomics.store(job.control, 1, message.sequence); Atomics.notify(job.control, 1); }
    } else if (message.type === 'result') { this.settle(job, null, message.result); this.drain(); }
    else if (message.type === 'error') {
      const error = serviceError(message.error?.message || 'The file operation failed.', message.error?.code || 'ENGINE_ERROR', message.error?.name || 'Error');
      this.settle(job, error); this.drain();
    }
  }
  ownedTemporary(job, file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !/^\.sift-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-z0-9]+$/i.test(path.basename(file))) return false;
    const sources = (Array.isArray(job.payload?.paths) ? job.payload.paths : []).filter(value => typeof value === 'string').map(localPath);
    const folders = job.payload?.outputDir ? [localPath(job.payload.outputDir)] : sources.map(value => localPath(path.dirname(value)));
    return !sources.includes(localPath(file)) && folders.includes(localPath(path.dirname(file)));
  }
  settle(job, error, result) {
    if (job.settled) return; job.settled = true;
    for (const subscriber of job.subscribers) subscriber.signal?.removeEventListener('abort', subscriber.abort);
    this.jobs.delete(job.id); if (job.key && this.duplicates.get(job.key) === job) this.duplicates.delete(job.key);
    if (this.active === job) this.active = null;
    const rows = Array.isArray(result) ? result : [];
    this.record(job.cancelled ? 'job-cancelled' : error ? 'job-failed' : 'job-finished', { id: job.id, operation: job.operation,
      elapsedMs: job.startedAt ? Math.round(performance.now() - job.startedAt) : 0,
      ...(error ? { code: error.code || 'ENGINE_ERROR' } : { saved: rows.filter(row => row?.path && !row.error).length, failed: rows.filter(row => row?.error).length }) });
    if (error) job.reject(error); else job.resolve(result); this.changed();
  }
  async reapChildren() {
    const pids = [...this.children];
    await Promise.all(pids.map(async pid => {
      try { if (await stopOwnedChild(pid)) { this.children.delete(pid); return; } }
      catch { /* Keep ownership and fail closed if native cleanup cannot confirm exit. */ }
      this.record('child-cleanup-unconfirmed');
    }));
    if (this.children.size) throw serviceError('An encoder could not be stopped safely. Close it before quitting Sift.', 'CLEANUP_FAILED');
  }
  async clearTemporaries() {
    for (const file of this.temporaries) {
      let removed = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try { await fs.unlink(file); removed = true; break; }
        catch (error) { if (error.code === 'ENOENT') { removed = true; break; } }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (removed) this.temporaries.delete(file);
    }
    if (this.temporaries.size) throw serviceError('Temporary file cleanup could not finish. Try quitting again shortly.', 'CLEANUP_FAILED');
  }
  async exited(code) {
    clearTimeout(this.exitTimer); this.exitTimer = null;
    const expected = this.retiring && !this.active;
    this.worker = null; this.retiring = false; this.recovering = true;
    try { await this.reapChildren(); await this.clearTemporaries(); }
    catch (error) { this.cleanupFailure = error; this.record('cleanup-failed', { code: error.code }); }
    if (this.active) {
      const error = serviceError('The file worker stopped unexpectedly. Completed outputs were preserved; retry the remaining files.', 'WORKER_EXIT');
      error.results = [...this.active.completed.values()]; this.settle(this.active, error);
    }
    this.record(expected ? 'worker-idle-stopped' : 'worker-exited', { code }); this.recovering = false;
    if (this.cleanupFailure) {
      for (const job of this.queue.splice(0)) this.settle(job, this.cleanupFailure);
      this.shutdownReject?.(this.cleanupFailure);
    }
    this.changed(); this.drain();
  }
  retire() {
    clearTimeout(this.idleTimer); this.idleTimer = null;
    if (this.active || this.recovering || this.retiring) return;
    if (!this.worker) { if (this.closing) this.shutdownResolve?.(); this.changed(); return; }
    this.retiring = true; this.worker.ref();
    this.worker.postMessage({ type: 'close' });
    // Termination is permitted only after all work and child cleanup completed.
    this.exitTimer = setTimeout(() => { if (this.retiring && !this.active && !this.children.size) void this.worker?.terminate(); }, 1500);
    this.exitTimer.unref?.();
  }
  shutdown() {
    if (this.shutdownPromise && !this.cleanupFailure) return this.shutdownPromise;
    this.shutdownPromise = new Promise((resolve, reject) => { this.shutdownResolve = resolve; this.shutdownReject = reject; });
    this.shutdownPromise.catch(() => {});
    this.closing = true; clearTimeout(this.idleTimer);
    for (const job of [...this.queue]) this.cancel(job.id);
    if (this.active) this.cancel(this.active.id);
    this.record('shutdown-requested'); this.changed();
    if (this.cleanupFailure) {
      this.recovering = true;
      void (async () => {
        try { await this.reapChildren(); await this.clearTemporaries(); this.cleanupFailure = null; }
        catch (error) { this.cleanupFailure = error; this.shutdownReject(error); }
        finally { this.recovering = false; this.changed(); this.drain(); }
      })();
    } else this.drain();
    return this.shutdownPromise;
  }
}
module.exports = { createEngineService: options => new EngineService(options) };
