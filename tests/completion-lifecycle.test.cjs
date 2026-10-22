'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { successfulCompletion, createCompletionLifecycle } = require('../src/completion-lifecycle.cjs');
function clock() {
  let now = 0, sequence = 0; const tasks = new Map();
  return { schedule(fn, delay) { const id = ++sequence; tasks.set(id, { fn, at: now + delay }); return id; },
    unschedule(id) { tasks.delete(id); },
    tick(ms) { const end = now + ms; for (;;) { const next = [...tasks.entries()].filter(([,task]) => task.at <= end).sort((a,b) => a[1].at-b[1].at)[0]; if (!next) break; tasks.delete(next[0]); now = next[1].at; next[1].fn(); } now = end; },
    tasks };
}
function fixture(overrides = {}) {
  const time = clock(), calls = [];
  const controller = createCompletionLifecycle({ ...time,
    present: (summary, token) => calls.push(['present', token, summary]), hideSource: () => calls.push(['hide-source']),
    dismiss: token => calls.push(['dismiss', token]), fade: token => calls.push(['fade', token]),
    reveal: file => { calls.push(['reveal', file]); return true; }, ...overrides });
  return { time, calls, controller };
}
const saved = [{ path: '/output/photo-converted.webp', name: 'photo-converted.webp' }];

test('complete successful conversions and tool outputs hide source immediately, keep Show for 2s then fade180ms', async () => {
  for (const results of [saved, { results: saved }]) {
    const { time, calls, controller } = fixture(), token = controller.begin();
    assert.equal(controller.complete(token, results), true); assert.deepEqual(calls, [['hide-source']]);
    await Promise.resolve(); assert.equal(calls[1][0], 'present');
    time.tick(9000); assert.equal(controller.snapshot().phase, 'preparing');
    assert.equal(controller.visible(token), true); time.tick(1999);
    assert.equal(controller.snapshot().phase, 'visible'); assert.ok(!calls.some(row => row[0] === 'fade'));
    time.tick(1); assert.equal(controller.snapshot().phase, 'fading'); assert.deepEqual(calls.at(-1), ['fade', token]);
    time.tick(179); assert.ok(controller.snapshot()); time.tick(1);
    assert.equal(controller.snapshot(), null); assert.deepEqual(calls.at(-1), ['dismiss', token]);
  }
});

test('failures, partial successes, cancelled batches and empty results never dismiss recovery UI', async () => {
  const cases = [[], [{error:'Failed'}], [...saved,{error:'Second file failed'}], [{}], [null]];
  for (const results of cases) {
    const { calls, controller } = fixture(); assert.equal(controller.complete(controller.begin(), results), false); assert.deepEqual(calls, []);
  }
  const { calls, controller } = fixture(); assert.equal(controller.complete(controller.begin(), saved, {cancelled:true}), false); assert.deepEqual(calls, []);
  assert.equal(successfulCompletion(saved, true), null);
});

test('Show at 1.7s dismisses toast first and reveals the main-held successful output once', async () => {
  const { time, calls, controller } = fixture(), token = controller.begin();
  controller.complete(token, saved); await Promise.resolve(); controller.visible(token); time.tick(1700);
  assert.equal(await controller.show(token), true);
  assert.deepEqual(calls.slice(-2), [['dismiss',token],['reveal',saved[0].path]]);
  assert.equal(await controller.show(token), false); time.tick(10000);
  assert.equal(calls.filter(row => row[0] === 'reveal').length, 1); assert.ok(!calls.some(row => row[0] === 'fade'));
});

test('new wheel/job invalidates old ready and fade timers without ever hiding the reopened source', async () => {
  const { time, calls, controller } = fixture(), first = controller.begin();
  controller.complete(first, saved); await Promise.resolve(); controller.visible(first); time.tick(2000);
  const newJob = controller.begin(); const sourceHideCount = calls.filter(row=>row[0]==='hide-source').length;
  assert.equal(controller.visible(first), false); assert.equal(controller.complete(first, saved), false);
  time.tick(1000); assert.equal(calls.filter(row=>row[0]==='hide-source').length, sourceHideCount);
  assert.equal(controller.complete(newJob, saved), true); await Promise.resolve(); controller.visible(newJob);
  time.tick(1000); assert.equal(controller.snapshot().phase, 'visible');
});

test('a superseded asynchronous toast load and duplicate completion cannot restart its lifetime', async () => {
  const { calls, controller } = fixture(), token = controller.begin();
  controller.complete(token, saved); assert.equal(controller.complete(token, saved), false);
  controller.cancel(); await Promise.resolve();
  assert.ok(!calls.some(row=>row[0]==='present')); assert.equal(controller.visible(token), false);
});

test('missing output reveal returns false after toast is dismissed; presentation failures clean up', async () => {
  const a = fixture({reveal:()=>false}), token = a.controller.begin(); a.controller.complete(token,saved); await Promise.resolve();
  assert.equal(await a.controller.show(token),false); assert.equal(a.controller.snapshot(),null);
  const errors = [], b = fixture({present:()=>{throw new Error('Display unavailable');},onError:error=>errors.push(error.message)});
  b.controller.complete(b.controller.begin(),saved); await Promise.resolve(); await Promise.resolve();
  assert.equal(b.controller.snapshot(),null); assert.deepEqual(errors,['Display unavailable']);
});

test('completion waits for native dialog dismissal and quit invalidation cancels deferred presentation', async () => {
  let dialogOpen = true;
  const { time, calls, controller } = fixture({canPresent:()=>!dialogOpen}), token = controller.begin();
  assert.equal(controller.complete(token,saved),true);
  time.tick(2000); await Promise.resolve(); assert.deepEqual(calls,[]);
  assert.equal(time.tasks.size,1);
  dialogOpen=false; time.tick(50); await Promise.resolve();
  assert.deepEqual(calls.map(row=>row[0]),['hide-source','present']);
  controller.visible(token); time.tick(1999); assert.equal(controller.snapshot().phase,'visible');
  controller.cancel(); dialogOpen=true;
  const next=controller.begin(); controller.complete(next,saved); time.tick(50);
  controller.cancel(); dialogOpen=false; time.tick(5000); await Promise.resolve();
  assert.equal(calls.filter(row=>row[0]==='hide-source').length,1);
  assert.equal(time.tasks.size,0);
});
