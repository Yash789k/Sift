'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { create, tickSamples } = require('../src/wheel-sound.js');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ suspended = false, resume } = {}) {
  let time = 0, enabled = true, busy = false, creations = 0, closes = 0, resumes = 0;
  const sources = [], timers = new Map(); let timerId = 0;
  const context = {
    state: suspended ? 'suspended' : 'running', sampleRate: 48000, destination: {},
    async resume() { resumes++; if (resume) await resume.promise; this.state = 'running'; },
    async suspend() { this.state = 'suspended'; },
    async close() { closes++; this.state = 'closed'; },
    createBuffer(_channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; },
    createBufferSource() {
      const source = { started: false, stopped: false, disconnected: false, connect() {},
        start() { this.started = true; }, stop() { this.stopped = true; }, disconnect() { this.disconnected = true; } };
      sources.push(source); return source;
    },
  };
  const sound = create({ createContext: () => { creations++; return context; }, isEnabled: () => enabled, isBusy: () => busy,
    now: () => time, schedule: callback => { timers.set(++timerId, callback); return timerId; }, unschedule: id => timers.delete(id) });
  return { sound, context, sources, timers, advance: value => { time += value; }, setEnabled: value => { enabled = value; }, setBusy: value => { busy = value; },
    get creations() { return creations; }, get closes() { return closes; }, get resumes() { return resumes; } };
}
test('tick has quiet bounded amplitude, short duration and zero-valued boundaries', () => {
  for (const sampleRate of [8000, 44100, 48000, 96000]) {
    const samples = tickSamples(sampleRate);
    assert.equal(samples.length, Math.ceil(sampleRate * 0.048));
    assert.equal(samples[0], 0); assert.equal(Math.abs(samples.at(-1)), 0);
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    assert.ok(peak > 0.01 && peak < 0.028); assert.ok(rms > 0.001 && rms < 0.008);
    assert.ok(samples.every(Number.isFinite));
  }
});
test('disabled and busy hover allocate no audio context', async () => {
  const f = fixture(); f.setEnabled(false); assert.equal(await f.sound.hover('format:png'), false);
  f.setEnabled(true); f.setBusy(true); assert.equal(await f.sound.hover('format:webp'), false);
  assert.equal(f.creations, 0); assert.equal(f.sources.length, 0);
});
test('one tick per target transition with bounded frequency and one reused context/buffer', async () => {
  const f = fixture(); assert.equal(f.creations, 0);
  assert.equal(await f.sound.hover('formats:png'), true); assert.equal(f.creations, 1);
  f.advance(100); assert.equal(await f.sound.hover('formats:png'), false);
  assert.equal(await f.sound.hover('formats:webp'), true);
  f.advance(5); assert.equal(await f.sound.hover('formats:pdf'), false);
  f.advance(100); assert.equal(await f.sound.hover('formats:pdf'), false);
  assert.equal(await f.sound.hover('tools:crop'), true);
  assert.equal(f.creations, 1); assert.equal(f.sources.length, 3); assert.equal(f.sources[0].buffer, f.sources[2].buffer);
});
test('suspended native-drag context resumes without requiring a click hook', async () => {
  const f = fixture({ suspended: true });
  assert.equal(await f.sound.hover('formats:png'), true); assert.equal(f.resumes, 1); assert.equal(f.sources[0].started, true);
});
test('pending resume only sounds the latest target and is cancelled by reset/hide', async () => {
  const resume = deferred(), f = fixture({ suspended: true, resume });
  const first = f.sound.hover('formats:png'), second = f.sound.hover('formats:webp');
  resume.resolve(); assert.equal(await first, false); assert.equal(await second, true); assert.equal(f.sources.length, 1);
  const otherResume = deferred(), other = fixture({ suspended: true, resume: otherResume });
  const pending = other.sound.hover('tools:crop'); other.sound.reset(); otherResume.resolve();
  assert.equal(await pending, false); assert.equal(other.sources.length, 0);
});
test('disabling or entering busy state during resume prevents delayed feedback', async () => {
  for (const change of ['setEnabled', 'setBusy']) {
    const resume = deferred(), f = fixture({ suspended: true, resume });
    const pending = f.sound.hover('tools:crop'); f[change](change === 'setBusy'); resume.resolve();
    assert.equal(await pending, false); assert.equal(f.sources.length, 0);
  }
});
test('long-delayed audio initialization is discarded instead of sounding stale feedback', async () => {
  const resume = deferred(), f = fixture({ suspended: true, resume });
  const pending = f.sound.hover('formats:png'); f.advance(600); resume.resolve();
  assert.equal(await pending, false); assert.equal(f.sources.length, 0);
});
test('idle audio suspends; disposal closes context and cancels all pending playback', async () => {
  const f = fixture(); await f.sound.hover('formats:png');
  f.sources[0].onended(); assert.equal(f.sources[0].disconnected, true);
  for (const timer of f.timers.values()) timer(); assert.equal(f.context.state, 'suspended');
  f.advance(100); await f.sound.hover('tools:crop');
  f.sound.dispose(); f.sound.dispose(); assert.equal(f.closes, 1); assert.equal(f.sources[1].stopped, true);
  assert.equal(await f.sound.hover('tools:edit'), false);
});
test('unavailable audio or a rejected resume never escapes into conversion handlers', async () => {
  const absent = create({ createContext: () => null }); assert.equal(await absent.hover('formats:png'), false); absent.dispose();
  const failed = create({ createContext: () => { throw new Error('no output device'); }, schedule: () => 1, unschedule() {} });
  assert.equal(await failed.hover('formats:png'), false); failed.dispose();
  const resume = deferred(), f = fixture({ suspended: true, resume }); const pending = f.sound.hover('formats:png');
  resume.reject(new Error('audio denied')); assert.equal(await pending, false); assert.equal(f.sources.length, 0); f.sound.dispose();
});
test('failed source startup disconnects it and does not keep the audio context active', async () => {
  const f = fixture();
  const makeSource = f.context.createBufferSource.bind(f.context);
  f.context.createBufferSource = () => {
    const source = makeSource(); source.start = () => { throw new Error('output unavailable'); }; return source;
  };
  assert.equal(await f.sound.hover('formats:png'), false); assert.equal(f.sources[0].disconnected, true);
  for (const timer of f.timers.values()) timer(); assert.equal(f.context.state, 'suspended');
  f.sound.dispose();
});
