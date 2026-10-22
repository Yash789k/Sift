'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { keepWindowInBackground, createQuitCoordinator } = require('../src/background-lifecycle.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('closing every utility/editor window hides it and does not exit the app', () => {
  let quitting = false, hides = 0, prevented = 0, hidden = 0;
  const window = new EventEmitter(); window.hide = () => hides++;
  keepWindowInBackground(window, { isQuitting: () => quitting, onHide: () => hidden++ });
  for (let index = 0; index < 3; index++) window.emit('close', { preventDefault: () => prevented++ });
  assert.equal(hides, 3); assert.equal(prevented, 3); assert.equal(hidden, 3);
  quitting = true; window.emit('close', { preventDefault: () => prevented++ });
  assert.equal(prevented, 3); assert.equal(hides, 3);
});

test('Keep running never cancels work or completes shutdown', async () => {
  let shutdown = 0, finished = 0;
  const quit = createQuitCoordinator({ hasJobs: () => true, confirm: async () => false,
    shutdown: async () => shutdown++, finish: () => finished++ });
  assert.equal(await quit.request(), false); assert.equal(shutdown, 0); assert.equal(finished, 0);
  assert.equal(quit.canExit(), false); assert.equal(quit.isStopping(), false);
});

test('simultaneous Quit requests share one dialog and wait for worker cleanup', async () => {
  const answer = deferred(), cleanup = deferred(); let confirms = 0, shutdowns = 0, finished = 0;
  const quit = createQuitCoordinator({ hasJobs: () => true, confirm: () => { confirms++; return answer.promise; },
    shutdown: () => { shutdowns++; return cleanup.promise; }, finish: () => finished++ });
  const first = quit.request(), second = quit.request(); assert.equal(first, second); assert.equal(confirms, 1);
  answer.resolve(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(quit.isStopping(), true); assert.equal(shutdowns, 1); assert.equal(finished, 0); assert.equal(quit.canExit(), false);
  cleanup.resolve(); assert.equal(await first, true); assert.equal(finished, 1); assert.equal(quit.canExit(), true);
  assert.equal(await quit.request(), true); assert.equal(finished, 1);
});

test('idle Quit bypasses confirmation but still waits for worker shutdown', async () => {
  const cleanup = deferred(); let finished = false;
  const quit = createQuitCoordinator({ hasJobs: () => false, confirm: () => assert.fail('No idle confirmation'),
    shutdown: () => cleanup.promise, finish: () => { finished = true; } });
  const pending = quit.request(); assert.equal(finished, false);
  cleanup.resolve(); await pending; assert.equal(finished, true);
});

test('cleanup failure leaves app running and a later Quit can retry', async () => {
  let attempts = 0, finished = 0;
  const quit = createQuitCoordinator({ hasJobs: () => false, confirm: async () => true,
    shutdown: async () => { if (++attempts === 1) throw new Error('encoder still running'); }, finish: () => finished++ });
  await assert.rejects(quit.request(), /encoder still running/); assert.equal(quit.isStopping(), false); assert.equal(finished, 0);
  assert.equal(await quit.request(), true); assert.equal(attempts, 2); assert.equal(finished, 1);
});
