'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stopOwnedChild, createDarwinExitProbe } = require('../src/child-cleanup.cjs');
const pid = process.pid + 1000;
const errors = { ECHILD: 10, EINTR: 4, EINVAL: 22 };
function probe(sequence) {
  let code;
  return createDarwinExitProbe({ errors, errno: () => code, waitpid: (target, status, options) => {
    assert.equal(target, pid); assert.equal(status, null); assert.equal(options, 1);
    assert.ok(sequence.length, 'unexpected extra waitpid call');
    const item = sequence.shift(); code = item.code; return item.result;
  } });
}

test('macOS reaps an exited child without signalling a zombie', async () => {
  assert.equal(await stopOwnedChild(pid, { exited: probe([{ result: pid }]), kill: () => assert.fail('must not signal an exited child') }), true);
});

test('macOS treats ECHILD as gone without signalling a potentially reused PID', async () => {
  assert.equal(await stopOwnedChild(pid, { exited: probe([{ result: -1, code: errors.ECHILD }]), kill: () => assert.fail('must not signal a non-child') }), true);
});

test('macOS terminates a live owned child and then reaps it', async () => {
  const signals = [];
  assert.equal(await stopOwnedChild(pid, { exited: probe([{ result: 0 }, { result: 0 }, { result: pid }]),
    kill: (target, signal) => { assert.equal(target, pid); signals.push(signal); }, sleep: async () => {} }), true);
  assert.deepEqual(signals, ['SIGTERM']);
});

test('macOS retries interrupted waitpid but fails closed on other errors', async () => {
  assert.equal(probe([{ result: -1, code: errors.EINTR }, { result: pid }])(pid), true);
  await assert.rejects(stopOwnedChild(pid, { exited: probe([{ result: -1, code: errors.EINVAL }]), kill: () => assert.fail('must not signal without ownership') }), /exit status/);
  assert.throws(() => probe(Array.from({ length: 8 }, () => ({ result: -1, code: errors.EINTR })))(pid), /repeatedly interrupted/);
});

test('cleanup escalates a stubborn child and reports an unconfirmed exit', async () => {
  const signals = []; let checks = 0;
  assert.equal(await stopOwnedChild(pid, { exited: () => { checks++; return false; }, kill: (target, signal) => signals.push(signal), sleep: async () => {} }), false);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']); assert.ok(checks > 20);
});

test('a child disappearing during a signal still gets an exit/reap check', async () => {
  assert.equal(await stopOwnedChild(pid, { exited: probe([{ result: 0 }, { result: pid }]),
    kill: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); } }), true);
});

test('cleanup rejects process groups, self and invalid PIDs without native calls', async () => {
  const exited = () => assert.fail('must not probe an invalid PID'), kill = () => assert.fail('must not signal an invalid PID');
  for (const invalid of [-1, 0, process.pid, 1.5, NaN, '42']) {
    await assert.rejects(stopOwnedChild(invalid, { exited, kill }), /Invalid owned child PID/);
    assert.throws(() => createDarwinExitProbe({ waitpid: exited })(invalid), /Invalid owned child PID/);
  }
});
