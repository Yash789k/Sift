'use strict';

function validatePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Invalid owned child PID.');
}

// Used only after the owning worker has exited, so its libuv process watcher
// cannot race us for waitpid. A dead Unix child can still answer kill(pid, 0)
// until it is reaped; probing with kill alone mistakes that zombie for an encoder.
function createDarwinExitProbe({ waitpid, errno, errors }) {
  return pid => {
    validatePid(pid);
    for (let attempt = 0; attempt < 8; attempt++) {
      const result = waitpid(pid, null, 1); // Darwin WNOHANG: never block the UI.
      if (result === pid) return true;
      if (result === 0) return false;
      const code = errno();
      // Already reaped (possibly by libuv). Do not signal a potentially reused PID.
      if (result === -1 && code === errors.ECHILD) return true;
      if (result === -1 && code === errors.EINTR) continue;
      throw new Error('Unable to determine owned child exit status.');
    }
    throw new Error('Owned child exit check was repeatedly interrupted.');
  };
}

let darwinExitProbe;
function hasExited(pid) {
  if (process.platform === 'darwin') {
    if (!darwinExitProbe) {
      const koffi = require('koffi');
      const library = koffi.load('/usr/lib/libSystem.B.dylib');
      darwinExitProbe = createDarwinExitProbe({
        waitpid: library.func('int waitpid(int pid, int *status, int options)'),
        errno: () => koffi.errno(), errors: koffi.os.errno
      });
    }
    return darwinExitProbe(pid);
  }
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}

async function stopOwnedChild(pid, { exited = hasExited, kill = process.kill, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  validatePid(pid);
  const signal = value => {
    try { kill(pid, value); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  // Check ownership/exit before sending any signal, including on a cleanup retry.
  if (exited(pid)) return true;
  signal('SIGTERM');
  for (let attempt = 0; attempt < 50; attempt++) {
    if (exited(pid)) return true;
    if (attempt === 20) signal('SIGKILL');
    await sleep(50);
  }
  return exited(pid);
}

module.exports = { stopOwnedChild, createDarwinExitProbe };
