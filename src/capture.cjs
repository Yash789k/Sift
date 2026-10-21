'use strict';
// Explicit development recording of this application's renderer only.
// No screen/other-window capture, network transmission, or UI state simulation.
const fs = require('node:fs/promises');
const path = require('node:path');
let active = null;

async function startCapture(win, directory, durationSeconds = 120) {
  if (active) throw new Error('A Sift capture is already running.');
  if (!path.isAbsolute(directory)) throw new Error('Capture needs an absolute folder.');
  const duration = Math.max(1, Math.min(180, Number(durationSeconds) || 120));
  await fs.mkdir(directory, { recursive: true });
  const session = { directory, started: Date.now(), frames: [], stop: false, retries: 0 };
  active = session;
  const tick = async () => {
    if (session.stop || win.isDestroyed() || Date.now() - session.started >= duration * 1000) {
      await fs.writeFile(path.join(directory, 'capture.json'), JSON.stringify({
        source: 'Sift Electron webContents.capturePage; live renderer',
        durationMs: Date.now() - session.started,
        frames: session.frames,
      }, null, 2));
      if (active === session) active = null;
      return;
    }
    const frameStarted = Date.now();
    try {
      const bitmap = await win.webContents.capturePage({}, { stayAwake: true });
      const name = `frame-${String(session.frames.length).padStart(5, '0')}.png`;
      await fs.writeFile(path.join(directory, name), bitmap.toPNG());
      session.frames.push({ file: name, timeMs: Date.now() - session.started });
    } catch (error) {
      // A newly shown Chromium surface can need a few compositor frames.
      // Retry that specific transient failure; never synthesize a missing frame.
      if (!session.frames.length && /Viz|surface|Frame Gone/.test(error.message) && session.retries++ < 20) {
        session.started = Date.now();
      } else {
        session.stop = true;
        await fs.writeFile(path.join(directory, 'capture-error.txt'), error.message);
      }
    }
    setTimeout(tick, Math.max(1, 100 - (Date.now() - frameStarted)));
  };
  void tick();
  return { directory, durationSeconds: duration };
}

function stopCapture() { if (active) active.stop = true; }
module.exports = { startCapture, stopCapture };
