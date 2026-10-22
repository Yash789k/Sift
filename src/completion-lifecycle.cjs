'use strict';

function successfulCompletion(results, cancelled = false) {
  const rows = Array.isArray(results) ? results : results?.results;
  if (cancelled || !Array.isArray(rows) || !rows.length || rows.some(row => !row || row.error || typeof row.path !== 'string' || !row.path)) return null;
  return { count: rows.length, path: rows[0].path, name: rows[0].name || 'File saved', warning: rows[0].warning || '' };
}

// The lifecycle owns only the short-lived toast. It never hides a wheel from a
// timer, so a new drag or editor cannot disappear at an earlier job's deadline.
function createCompletionLifecycle({ present, hideSource, dismiss, fade, reveal, canPresent = () => true, onError = () => {},
  visibleMs = 2000, fadeMs = 180, schedule = setTimeout, unschedule = clearTimeout }) {
  let generation = 0, current = null, timer;
  const isCurrent = token => Boolean(current && current.token === token && generation === token);
  function invalidate() {
    generation++;
    if (timer !== undefined) unschedule(timer);
    timer = undefined;
    const previous = current; current = null;
    if (previous) dismiss(previous.token);
    return generation;
  }
  function complete(token, results, { cancelled = false } = {}) {
    const summary = successfulCompletion(results, cancelled);
    if (!summary || token !== generation || current) return false;
    current = { token, summary, phase: 'preparing' };
    function prepare() {
      if (!isCurrent(token)) return;
      // An attached native dialog must retain its parent until it closes. This
      // token-guarded retry never delays the finished job's own promise.
      if (!canPresent()) { timer = schedule(prepare, 50); return; }
      timer = undefined;
      hideSource();
      Promise.resolve().then(() => { if (isCurrent(token)) return present(summary, token); }).catch(error => {
        if (isCurrent(token)) invalidate();
        onError(error);
      });
    }
    prepare();
    return true;
  }
  function visible(token) {
    if (!isCurrent(token) || current.phase !== 'preparing') return false;
    current.phase = 'visible';
    timer = schedule(() => {
      if (!isCurrent(token)) return;
      current.phase = 'fading'; fade(token);
      timer = schedule(() => { if (isCurrent(token)) invalidate(); }, fadeMs);
    }, visibleMs);
    return true;
  }
  async function show(token) {
    if (!isCurrent(token)) return false;
    const filePath = current.summary.path;
    invalidate();
    return reveal(filePath);
  }
  return { begin: invalidate, cancel: invalidate, complete, visible, show, isCurrent,
    snapshot: () => current ? { token: current.token, phase: current.phase } : null };
}
module.exports = { successfulCompletion, createCompletionLifecycle };
