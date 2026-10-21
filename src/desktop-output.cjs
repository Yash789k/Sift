'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Fire-and-forget from the main process after successful publication. A separate
// helper avoids delaying the drag-selection probe or marking saved files failed.
// Source/output paths stay in this private stdin channel, never diagnostic logs.
async function notifySavedOutputs(results, { repairExisting = false } = {}) {
  const outputs = [], seen = new Set();
  for (const item of Array.isArray(results) ? results : []) {
    if (item?.error || typeof item?.path !== 'string' || !path.isAbsolute(item.path)) continue;
    const destination = path.resolve(item.path), key = destination.toLowerCase();
    if (seen.has(key)) continue;
    const source = typeof item.source === 'string' && path.isAbsolute(item.source) ? path.resolve(item.source) : '';
    if (source && source.toLowerCase() === key) continue;
    seen.add(key); outputs.push({ path: destination, source });
    if (outputs.length >= 300) break;
  }
  const empty = { notified: 0, placed: 0, skipped: outputs.length };
  if (!outputs.length) return empty;
  if (process.platform !== 'win32') return { ...empty, reasons: { 'platform-not-windows': outputs.length } };
  const executable = path.join(__dirname, 'native', 'SelectionProbe.exe');
  if (!fs.existsSync(executable)) return { ...empty, reasons: { 'helper-unavailable': outputs.length } };
  return new Promise(resolve => {
    let child, timer, output = '', done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
    try {
      child = spawn(executable, ['--notify'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      timer = setTimeout(() => { child.kill(); finish({ ...empty, reasons: { 'helper-timeout': outputs.length } }); }, 5500);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { if (output.length < 512000) output += chunk; });
      child.on('error', () => finish({ ...empty, reasons: { 'helper-unavailable': outputs.length } }));
      child.stdin.on('error', () => finish({ ...empty, reasons: { 'helper-unavailable': outputs.length } }));
      child.on('close', () => {
        try {
          const value = JSON.parse(output.trim());
          if (!['notified', 'placed', 'skipped'].every(key => Number.isInteger(value[key]) && value[key] >= 0)) throw Error('Invalid summary');
          finish(value);
        } catch { finish({ ...empty, reasons: { 'helper-unavailable': outputs.length } }); }
      });
      child.stdin.end(JSON.stringify({ outputs, repairExisting: repairExisting === true }) + '\n');
    } catch { child?.kill(); finish({ ...empty, reasons: { 'helper-unavailable': outputs.length } }); }
  });
}
module.exports = { notifySavedOutputs };
