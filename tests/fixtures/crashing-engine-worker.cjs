'use strict';
// Deliberate protocol-level failure: a child and private temp exist, one output
// has been published, then the JS worker exits. No production crash switch.
const { parentPort } = require('node:worker_threads');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
parentPort.on('message', message => {
  if (message.type !== 'run') return;
  const temp = path.join(message.payload.outputDir, `.sift-${crypto.randomUUID()}.webm`);
  fs.writeFileSync(temp, 'incomplete encoder output');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  parentPort.postMessage({ type: 'temporary', id: message.id, path: temp, active: true });
  parentPort.postMessage({ type: 'child', id: message.id, pid: child.pid, active: true });
  const result = { source: message.payload.paths[0], path: message.payload.completedPath, name: path.basename(message.payload.completedPath) };
  parentPort.postMessage({ type: 'published', id: message.id, result });
  parentPort.postMessage({ type: 'progress', id: message.id, sequence: 1, value: { status: 'converting', childPid: child.pid, temporaryPath: temp } });
  setTimeout(() => process.exit(17), 100);
});
