(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiftWheelSound = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // A quiet, rounded tap. The short envelope begins and ends at zero; no audio
  // file, network request, microphone access, or operating-system volume change.
  function tickSamples(sampleRate) {
    const rate = Math.max(8000, Math.min(192000, Number(sampleRate) || 48000));
    const duration = 0.048, samples = new Float32Array(Math.ceil(rate * duration));
    let phase = 0;
    for (let index = 0; index < samples.length; index++) {
      const time = index / rate, position = index / (samples.length - 1);
      const attack = Math.sin(Math.min(1, time / 0.004) * Math.PI / 2) ** 2;
      const envelope = attack * Math.exp(-5.2 * position) * (1 - position) ** 2;
      const frequency = 540 + 220 * Math.exp(-time / 0.012);
      phase += 2 * Math.PI * frequency / rate;
      samples[index] = 0.028 * envelope * (0.86 * Math.sin(phase) + 0.14 * Math.sin(2 * phase));
    }
    return samples;
  }

  function create({
    isEnabled = () => true, isBusy = () => false,
    createContext = () => {
      const AudioContext = root.AudioContext || root.webkitAudioContext;
      return AudioContext ? new AudioContext({ latencyHint: 'interactive' }) : null;
    },
    now = () => root.performance?.now() ?? Date.now(),
    schedule = (callback, delay) => root.setTimeout(callback, delay),
    unschedule = id => root.clearTimeout(id),
    cooldownMs = 70,
  } = {}) {
    const cooldown = Math.max(50, Math.min(250, Number(cooldownMs) || 70));
    let context, buffer, resuming, idleTimer, target = '', generation = 0;
    let disposed = false, unavailable = false, lastPlayed = -Infinity;
    const sources = new Set();
    const allowed = () => !disposed && !unavailable && isEnabled() && !isBusy();
    function cancelIdle() { if (idleTimer !== undefined) { unschedule(idleTimer); idleTimer = undefined; } }
    function idleSoon() {
      cancelIdle();
      if (disposed) return;
      idleTimer = schedule(() => {
        idleTimer = undefined;
        if (!disposed && context?.state === 'running' && sources.size === 0) {
          try { Promise.resolve(context.suspend()).catch(() => {}); } catch {}
        }
      }, 1200);
      idleTimer?.unref?.();
    }
    function reset() { target = ''; generation++; }
    async function hover(key) {
      if (typeof key !== 'string' || !key || !allowed()) { reset(); return false; }
      if (key === target) return false;
      target = key;
      const version = ++generation, requestedAt = now();
      if (requestedAt - lastPlayed < cooldown) return false;
      let source;
      try {
        cancelIdle();
        if (!context || context.state === 'closed') {
          context = createContext(); buffer = undefined;
          if (!context) { unavailable = true; return false; }
        }
        if (context.state !== 'running') {
          if (!resuming) resuming = Promise.resolve(context.resume()).finally(() => { resuming = undefined; });
          await resuming;
        }
        // Resume may complete after a hide, a busy state, or a different target.
        // Never play delayed feedback for a selection that is no longer active.
        const playedAt = now();
        if (!allowed() || version !== generation || context.state !== 'running' ||
          playedAt - requestedAt > 500 || playedAt - lastPlayed < cooldown) { idleSoon(); return false; }
        if (!buffer) {
          const samples = tickSamples(context.sampleRate);
          buffer = context.createBuffer(1, samples.length, context.sampleRate);
          buffer.getChannelData(0).set(samples);
        }
        source = context.createBufferSource(); source.buffer = buffer;
        source.connect(context.destination); sources.add(source);
        source.onended = () => { sources.delete(source); try { source.disconnect(); } catch {} };
        source.start(); lastPlayed = playedAt; idleSoon(); return true;
      } catch {
        // Feedback must never interfere with dropping or converting a file.
        if (source) { sources.delete(source); try { source.disconnect(); } catch {} }
        idleSoon(); return false;
      }
    }
    function dispose() {
      if (disposed) return;
      disposed = true; reset(); cancelIdle();
      for (const source of sources) { try { source.stop(); source.disconnect(); } catch {} }
      sources.clear(); buffer = undefined;
      try { if (context && context.state !== 'closed') Promise.resolve(context.close()).catch(() => {}); } catch {}
    }
    return { hover, reset, dispose };
  }
  return { create, tickSamples };
});
