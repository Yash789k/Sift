'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Worker } = require('node:worker_threads');
const sharp = require('sharp');
const { createEngineService } = require('../src/engine-service.cjs');
const workspace = path.resolve(process.env.SIFT_TEST_ROOT || path.join(os.tmpdir(), 'sift-tests'));
const run = promisify(execFile), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
let root, original, second, third, movie, sourceHash;
async function output(name) { const result = path.join(root, name); await fs.mkdir(result); return result; }
async function noTemporary(folder) { assert.deepEqual((await fs.readdir(folder)).filter(name => name.startsWith('.sift-')), []); }
async function until(predicate, timeout = 5000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for worker state.'); await wait(20); }
}
function serviceFor(t, options) { const service = createEngineService(options); t.after(() => service.shutdown()); return service; }
test.before(async () => {
  await fs.mkdir(workspace, { recursive: true }); root = await fs.mkdtemp(path.join(workspace, 'sift-worker-test-'));
  original = path.join(root, 'Original_日本語.png'); second = path.join(root, 'Second.png'); third = path.join(root, 'Third.png');
  await sharp({ create: { width: 96, height: 64, channels: 4, background: '#e86d3c' } }).png().toFile(original);
  await fs.copyFile(original, second); await fs.copyFile(original, third); sourceHash = await hash(original);
  movie = path.join(root, 'Movie.mp4');
  await run(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', movie], { windowsHide: true });
});
test.after(async () => {
  assert.equal(await hash(original), sourceHash);
  const resolved = path.resolve(root);
  assert.ok(resolved.startsWith(workspace + path.sep) && path.basename(resolved).startsWith('sift-worker-test-'));
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3 });
});

test('worker stays lazy; inspection, previews and real tools execute outside the caller', async t => {
  const service = serviceFor(t);
  assert.equal(service.snapshot().workerActive, false);
  assert.equal(require.cache[require.resolve('../engine.cjs')], undefined);
  const caps = await service.request('getCapabilities'); assert.ok(caps.image.includes('webp'));
  const [file] = await service.request('inspectFiles', [original]); assert.equal(file.width, 96); assert.equal(file.height, 64);
  const preview = await service.request('previewFile', original);
  assert.equal((await sharp(Buffer.from(preview.split(',')[1], 'base64')).metadata()).width, 96);
  const inspection = await service.request('inspectTools', original); assert.equal(inspection.tools.length, 7);
  const editedPreview = await service.request('previewTool', { path: original, tool: 'edit', options: { rotate: 90 } });
  assert.equal((await sharp(Buffer.from(editedPreview.split(',')[1], 'base64')).metadata()).width, 64);
  const folder = await output('tool');
  const [result] = await service.request('runTool', { paths: [original], tool: 'crop', options: { left: 10, top: 10, width: 40, height: 20 }, outputDir: folder });
  assert.equal(result.error, undefined); assert.equal((await sharp(result.path).metadata()).width, 40);
  assert.equal(require.cache[require.resolve('../engine.cjs')], undefined);
  assert.equal(require.cache[require.resolve('../tools-engine.cjs')], undefined);
  await noTemporary(folder);
});

test('identical in-flight mutations coalesce, distinct jobs serialize, later repeats preserve collisions', async t => {
  const service = serviceFor(t), folder = await output('dedupe'), events = [];
  const request = { paths: [original], format: 'jpg', outputDir: folder };
  const first = service.submit('convert', request, { onProgress: value => events.push('first:' + value.status) });
  const duplicate = service.submit('convert', { ...request, format: 'jpeg', options: {} });
  assert.equal(first.id, duplicate.id); assert.equal(first.promise, duplicate.promise);
  const next = service.submit('convert', { ...request, format: 'webp' }, { onProgress: value => events.push('second:' + value.status) });
  const [[jpeg], [webp]] = await Promise.all([first.promise, next.promise]);
  assert.equal((await sharp(jpeg.path).metadata()).format, 'jpeg'); assert.equal((await sharp(webp.path).metadata()).format, 'webp');
  assert.ok(events.indexOf('first:complete') < events.indexOf('second:converting'));
  const savedHash = await hash(jpeg.path);
  const [again] = await service.request('convert', request);
  assert.notEqual(again.path, jpeg.path); assert.match(again.path, /\(2\)\.jpg$/);
  assert.equal(await hash(jpeg.path), savedHash); assert.equal(await hash(original), sourceHash);
  assert.equal((await fs.readdir(folder)).length, 3); await noTemporary(folder);
});

test('partial input failures survive and cancelling after first publish retains only completed output', async t => {
  const service = serviceFor(t), failedFolder = await output('partial-failure'), cancelFolder = await output('partial-cancel');
  const damaged = path.join(root, 'Damaged.png'); await fs.writeFile(damaged, 'invalid pixels');
  const mixed = await service.request('convert', { paths: [original, damaged], format: 'webp', outputDir: failedFolder });
  assert.equal(mixed.length, 2); assert.ok(mixed[0].path); assert.ok(mixed[1].error);
  const controller = new AbortController();
  const results = await service.request('convert', { paths: [original, second, third], format: 'webp', outputDir: cancelFolder }, {
    signal: controller.signal, onProgress: value => { if (value.status === 'complete') controller.abort(); },
  });
  assert.equal(results.filter(row => row.path).length, 1); assert.equal(results.filter(row => /cancelled/i.test(row.error || '')).length, 2);
  assert.equal((await fs.readdir(cancelFolder)).length, 1); await noTemporary(cancelFolder);
});

test('pre-cancelled and queued cancelled jobs do not create outputs or cancel unrelated work', async t => {
  const service = serviceFor(t), folder = await output('queued');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.request('convert', { paths: [original], format: 'png', outputDir: folder }, { signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.equal(service.snapshot().workerActive, false);
  const first = service.submit('convert', { paths: [original], format: 'webp', outputDir: folder });
  const queued = service.submit('convert', { paths: [original], format: 'jpeg', outputDir: folder });
  assert.equal(queued.cancel(), true); await assert.rejects(queued.promise, { code: 'ABORT_ERR' });
  assert.equal((await first.promise).filter(row => row.path).length, 1); assert.equal((await fs.readdir(folder)).length, 1);
});

test('real FFmpeg cancellation waits for process close and removes its unfinished file', async t => {
  const service = serviceFor(t), folder = await output('media-cancel'), controller = new AbortController(), before = await hash(movie);
  let sawEncoder = false;
  const job = service.submit('convert', { paths: [movie], format: 'webm', outputDir: folder }, {
    signal: controller.signal, onProgress: value => { if (typeof value.seconds === 'number') { sawEncoder = true; controller.abort(); } },
  });
  await assert.rejects(job.promise, { code: 'ABORT_ERR' }); assert.equal(sawEncoder, true);
  assert.equal(service.snapshot().childProcesses, 0); assert.equal((await fs.readdir(folder)).length, 0);
  assert.ok(service.diagnostics().some(row => row.event === 'child-started'));
  assert.ok(service.diagnostics().some(row => row.event === 'child-stopped'));
  assert.equal(await hash(movie), before);
});

test('shutdown cancels active media and queued work, waits for cleanup, and rejects new requests', async t => {
  const service = serviceFor(t), folder = await output('shutdown');
  let close;
  const active = service.submit('convert', { paths: [movie], format: 'webm', outputDir: folder }, {
    onProgress: value => { if (typeof value.seconds === 'number' && !close) close = service.shutdown(); },
  });
  const queued = service.submit('convert', { paths: [original], format: 'webp', outputDir: folder });
  await assert.rejects(active.promise, { code: 'ABORT_ERR' }); await assert.rejects(queued.promise, { code: 'ABORT_ERR' }); await close;
  assert.equal(service.snapshot().workerActive, false); assert.equal(service.snapshot().childProcesses, 0);
  assert.equal((await fs.readdir(folder)).length, 0);
  await assert.rejects(service.request('getCapabilities'), { code: 'SERVICE_CLOSED' });
});

test('idle workers exit and restart lazily; diagnostics are bounded and contain no private paths', async t => {
  const service = serviceFor(t, { idleMs: 40, logger: () => { throw new Error('Logger unavailable'); } });
  await service.request('inspectFiles', [original]);
  await until(() => !service.snapshot().workerActive);
  assert.equal(service.diagnostics().filter(row => row.event === 'worker-started').length, 1);
  await service.request('getCapabilities');
  assert.equal(service.diagnostics().filter(row => row.event === 'worker-started').length, 2);
  for (let i = 0; i < 40; i++) await service.request('getCapabilities');
  assert.equal(service.diagnostics().length, 100);
  const logs = JSON.stringify(service.diagnostics()); assert.ok(!logs.includes(original)); assert.ok(!logs.includes('Original')); assert.ok(!logs.includes(root));
});

test('a request arriving while an idle worker retires waits for a fresh worker without being lost', async t => {
  const service = serviceFor(t);
  await service.request('getCapabilities');
  service.retire();
  assert.equal(service.retiring, true);
  const [inspected] = await service.request('inspectFiles', [original]);
  assert.equal(inspected.width, 96);
  assert.equal(service.diagnostics().filter(row => row.event === 'worker-started').length, 2);
});

test('real media conversion completes in worker and produces decodable output', async t => {
  const service = serviceFor(t), folder = await output('media-success');
  const [result] = await service.request('convert', { paths: [movie], format: 'mp4', outputDir: folder });
  assert.equal(result.error, undefined); assert.ok(result.size > 1000);
  await run(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-i', result.path, '-frames:v', '1', '-f', 'null', '-'], { windowsHide: true });
  assert.equal(service.snapshot().childProcesses, 0); await noTemporary(folder);
});

test('unexpected worker exit preserves published output, reaps owned child and temp, and does not retry mutation', async t => {
  let starts = 0;
  const service = serviceFor(t, { workerFactory: (filename, options) => new Worker(++starts === 1 ? path.join(__dirname, 'fixtures', 'crashing-engine-worker.cjs') : filename, options) });
  const folder = await output('crash'), completedPath = path.join(folder, 'completed.webp');
  await sharp(original).webp().toFile(completedPath); const before = await hash(completedPath);
  let childPid, temporaryPath;
  const broken = service.submit('convert', { paths: [original], format: 'webp', outputDir: folder, completedPath }, {
    onProgress: value => { childPid = value.childPid; temporaryPath = value.temporaryPath; },
  });
  const queued = service.request('getCapabilities');
  await assert.rejects(broken.promise, error => error.code === 'WORKER_EXIT' && error.results.length === 1 && error.results[0].path === completedPath);
  assert.ok((await queued).image.includes('webp')); assert.equal(starts, 2);
  assert.ok(childPid); assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
  await assert.rejects(fs.stat(temporaryPath), { code: 'ENOENT' });
  assert.equal(await hash(completedPath), before); assert.deepEqual(await fs.readdir(folder), ['completed.webp']);
});
