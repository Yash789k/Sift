'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { notifySavedOutputs } = require('../src/desktop-output.cjs');

test('desktop notifier ignores empty, failed and original-path results', async () => {
  const original = path.join(os.tmpdir(), 'sift-original.png');
  for (const input of [null, [], [{ error: 'Failed', path: original }], [{ source: original, path: original }], [{ path: 'relative.png' }]]) {
    assert.deepEqual(await notifySavedOutputs(input), { notified: 0, placed: 0, skipped: 0 });
  }
});

test('native notifier refreshes non-desktop outputs once without moving or altering files', { skip: process.platform !== 'win32' }, async () => {
  const root = path.resolve(process.env.SIFT_TEST_ROOT || path.join(os.tmpdir(), 'sift-tests'));
  await fs.mkdir(root, { recursive: true });
  const folder = await fs.mkdtemp(path.join(root, 'desktop-notify-'));
  try {
    const source = path.join(folder, '源 image.png'), output = path.join(folder, '源 image-converted.webp');
    await fs.writeFile(source, 'original bytes'); await fs.writeFile(output, 'output bytes');
    const row = { source, path: output };
    const summary = await notifySavedOutputs([row, row, { source, path: path.join(folder, 'missing.webp') }]);
    assert.equal(summary.notified, 1); assert.equal(summary.placed, 0); assert.equal(summary.skipped, 2);
    assert.equal(summary.reasons['outside-desktop'], 1); assert.equal(summary.reasons['output-missing'], 1);
    assert.equal(await fs.readFile(source, 'utf8'), 'original bytes'); assert.equal(await fs.readFile(output, 'utf8'), 'output bytes');
    assert.equal(JSON.stringify(summary).includes(folder), false, 'Returned evidence must not contain private paths');
  } finally {
    const resolved = path.resolve(folder);
    assert.ok(resolved.startsWith(root + path.sep) && path.basename(resolved).startsWith('desktop-notify-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('native desktop inspection reads arrangement and visibility without changing icons', { skip: process.platform !== 'win32' }, async () => {
  const executable = path.resolve(__dirname, '../src/native/SelectionProbe.exe');
  const summary = await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--notify'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(Error('Native inspection timeout')); }, 5500);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => output += chunk);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(output)); } catch (error) { reject(error); } });
    child.stdin.end(JSON.stringify({ outputs: [], inspectDesktop: true }) + '\n');
  });
  assert.equal(summary.notified, 0); assert.equal(summary.placed, 0); assert.equal(summary.skipped, 0);
  assert.equal(typeof summary.iconsHidden, 'boolean'); assert.equal(typeof summary.desktopAvailable, 'boolean');
  assert.ok(summary.autoArrange === null || typeof summary.autoArrange === 'boolean');
});
