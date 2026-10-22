'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createJobManager } = require('../src/job-manager.cjs');
function fixture() {
  let resolve, reject, options, submits = 0; const saved = [];
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  const manager = createJobManager({ submit: (_operation, _payload, value) => { submits++; options = value; return { id: 'real-job', promise }; },
    onResults: async results => saved.push(results) });
  return { manager, resolve, reject, saved, get options() { return options; }, get submits() { return submits; } };
}
test('duplicate mutation calls share one result and publish saved files only once', async () => {
  const f = fixture(); const request = { paths: ['/sample.png'], format: 'webp', options: { width: 400, quality: 80 } };
  const a = f.manager.run('convert', request, 'webp');
  const b = f.manager.run('convert', { ...request, options: { quality: 80, width: 400 } }, 'webp');
  assert.equal(a, b); assert.equal(f.submits, 1); assert.equal(f.manager.snapshot().length, 1);
  await assert.rejects(f.manager.run('convert', { ...request, format: 'png' }, 'png'), /already running/);
  const rows = [{ path: '/sample-converted.webp', name: 'sample-converted.webp' }]; f.resolve(rows);
  assert.deepEqual(await a, rows); assert.deepEqual(await b, rows); assert.equal(f.saved.length, 1);
  assert.equal(f.manager.snapshot()[0].status, 'completed'); assert.equal(f.manager.current, null);
});
test('progress reaches jobs; cancelling preserves published partial results', async () => {
  const f = fixture(); const promise = f.manager.run('convert', { paths: ['/a.png', '/b.png'] }, 'webp');
  f.options.onProgress({ index: 1, total: 2, status: 'complete' }); assert.equal(f.manager.snapshot()[0].progress.index, 1);
  assert.equal(f.manager.cancel('other-job'), false); assert.equal(f.manager.cancel('real-job'), true); assert.equal(f.options.signal.aborted, true);
  assert.equal(f.manager.snapshot()[0].status, 'cancelling');
  f.resolve([{ path: '/a.webp' }, { name: 'b.png', error: 'Cancelled' }]); await promise;
  assert.equal(f.manager.snapshot()[0].status, 'cancelled'); assert.equal(f.saved.length, 1);
});
test('worker failure records known completed outputs without retrying the mutation', async () => {
  const f = fixture(); const promise = f.manager.run('convert', { paths: ['/a.png'] }, 'webp');
  const error = Object.assign(new Error('worker exited'), { code: 'WORKER_EXIT', results: [{ path: '/a.webp' }] }); f.reject(error);
  await assert.rejects(promise, /worker exited/); assert.equal(f.saved.length, 1); assert.equal(f.submits, 1);
  assert.equal(f.manager.snapshot()[0].status, 'failed'); assert.deepEqual(f.manager.snapshot()[0].results, error.results);
});
test('all-file errors are failed, while mixed saved results are partly saved', async () => {
  for (const [results, status] of [[[{ name: 'a.png', error: 'Invalid image' }], 'failed'],
    [[{ path: '/a.webp' }, { name: 'b.png', error: 'Invalid image' }], 'completed-with-errors']]) {
    const f = fixture(); const promise = f.manager.run('convert', { paths: ['/a.png'] }, 'webp');
    f.resolve(results); await promise; assert.equal(f.manager.snapshot()[0].status, status);
    assert.deepEqual(f.manager.snapshot()[0].results, results);
  }
});
