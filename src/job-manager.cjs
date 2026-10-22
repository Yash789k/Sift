'use strict';
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function createJobManager({ submit, onChange = () => {}, onResults = async () => {}, logger = () => {} }) {
  let active = null;
  const jobs = [];
  const snapshot = () => jobs.map(({ key, promise, cancel, controller, ...job }) => ({ ...job }));
  const publish = () => onChange(snapshot());
  function run(operation, request, label) {
    const key = JSON.stringify([operation, stable(request)]);
    if (active) {
      if (active.key === key) return active.promise;
      return Promise.reject(new Error('A file operation is already running. Open Current jobs to view or cancel it.'));
    }
    const controller = new AbortController();
    const job = { id: '', operation: label, status: 'running', createdAt: Date.now(), startedAt: Date.now(), key, controller };
    active = job; jobs.unshift(job); jobs.splice(30);
    let handle;
    try {
      handle = submit(operation, request, { signal: controller.signal, onProgress: progress => {
        job.progress = progress; publish();
      } });
      job.id = handle.id; job.cancel = () => controller.abort();
    } catch (error) {
      active = null; jobs.shift(); return Promise.reject(error);
    }
    job.promise = (async () => {
      try {
        const results = await handle.promise;
        job.results = results;
        await onResults(results, label);
        const failed = results.filter(row => row.error).length;
        job.status = controller.signal.aborted ? 'cancelled' : failed === results.length && failed > 0 ? 'failed' : failed ? 'completed-with-errors' : 'completed';
        logger('job-finished', { id: job.id, operation: label, status: job.status, count: results.length });
        return results;
      } catch (error) {
        if (Array.isArray(error.results) && error.results.length) { job.results = error.results; await onResults(error.results, label); }
        job.status = controller.signal.aborted || error.code === 'ABORT_ERR' ? 'cancelled' : 'failed';
        job.error = error.message;
        logger('job-failed', { id: job.id, operation: label, status: job.status, message: error.message });
        throw error;
      } finally {
        job.completedAt = Date.now(); active = null; publish();
      }
    })();
    logger('job-started', { id: job.id, operation: label, count: request.paths.length }); publish();
    return job.promise;
  }
  function cancel(id) { if (!active || (id && active.id !== id)) return false; active.cancel(); active.status = 'cancelling'; publish(); return true; }
  return { run, cancel, snapshot, get current() { return active; } };
}
module.exports = { createJobManager };
