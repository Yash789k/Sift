'use strict';

function keepWindowInBackground(window, { isQuitting, onHide = () => {} }) {
  const close = event => {
    if (isQuitting()) return;
    event.preventDefault();
    window.hide();
    onHide();
  };
  window.on('close', close);
  return () => window.removeListener('close', close);
}

function createQuitCoordinator({ hasJobs, confirm, shutdown, finish, logger = () => {} }) {
  let pending, approved = false, finished = false;
  function request() {
    if (finished) return Promise.resolve(true);
    if (pending) return pending;
    pending = (async () => {
      try {
        if (hasJobs() && !await confirm()) return false;
        approved = true;
        logger('shutdown-start');
        await shutdown(); // Cooperative cancellation waits for encoder/file cleanup.
        finished = true;
        logger('shutdown-complete');
        finish();
        return true;
      } catch (error) {
        approved = false;
        logger('shutdown-failed', { message: error.message });
        throw error;
      } finally { pending = undefined; }
    })();
    return pending;
  }
  return { request, isStopping: () => approved, canExit: () => finished };
}
module.exports = { keepWindowInBackground, createQuitCoordinator };
