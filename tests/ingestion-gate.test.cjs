const test = require('node:test');
const assert = require('node:assert/strict');
const { createIngestionGate } = require('../src/ingestion-gate.js');

test('one ingestion owns the entire async inspect, expand and conversion workflow', async () => {
  const phases = [];
  let finishInspection, finishConversion;
  const inspection = new Promise(resolve => { finishInspection = resolve; });
  const conversion = new Promise(resolve => { finishConversion = resolve; });
  const gate = createIngestionGate(active => phases.push(active ? 'locked' : 'released'));
  const first = gate.run(async () => {
    phases.push('inspect');
    await inspection;
    phases.push('expand');
    await conversion;
    phases.push('converted');
  });
  let competingRan = false;
  assert.deepEqual(await gate.run(async () => { competingRan = true; }), { accepted: false });
  finishInspection();
  await Promise.resolve();
  assert.equal(gate.isActive(), true);
  assert.deepEqual(await gate.run(async () => { competingRan = true; }), { accepted: false });
  finishConversion();
  assert.equal((await first).accepted, true);
  assert.equal(competingRan, false);
  assert.deepEqual(phases, ['locked', 'inspect', 'expand', 'converted', 'released']);
  assert.equal(gate.isActive(), false);
});

test('failed inspection releases the gate and the next file operation can proceed', async () => {
  const states = [];
  const gate = createIngestionGate(active => states.push(active));
  await assert.rejects(gate.run(async () => { throw new Error('Unreadable file'); }), /Unreadable file/);
  assert.equal(gate.isActive(), false);
  assert.deepEqual(await gate.run(async () => 'next file'), { accepted: true, value: 'next file' });
  assert.deepEqual(states, [true, false, true, false]);
});
