'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const appRoot = process.platform === 'darwin' ? path.resolve(path.dirname(process.execPath), '../Resources/app') : path.join(path.dirname(process.execPath), 'resources', 'app');
const requireApp = createRequire(path.join(appRoot, 'package.json'));
const { convert } = requireApp('./engine.cjs');
const sharp = requireApp('sharp');
const ffmpeg = requireApp('ffmpeg-static');
const run = promisify(execFile);
const folder = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'sift-packaged-smoke-'));
require('./check-release-codecs.cjs').checkReleaseCodecs(appRoot);
const checks = [];
async function main() {
  await fs.mkdir(folder, { recursive: true });
  const original = path.join(folder, 'original.png');
  await fs.copyFile(path.join(appRoot, 'samples/Aurora.png'), original);
  const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const before = await hash(original);
  for (const format of ['jpeg', 'webp', 'heic']) {
    const result = await convert({ paths: [original], format, outputDir: folder });
    assert.equal(result.length, 1);
    assert.equal(result[0].error, undefined);
    assert.ok((await fs.stat(result[0].path)).size > 0);
    if (format !== 'heic') assert.equal((await sharp(result[0].path).metadata()).format, format);
    else {
      const decoded = await requireApp('heic-decode')({ buffer: await fs.readFile(result[0].path) });
      assert.ok(decoded.width > 0 && decoded.height > 0 && decoded.data.length === decoded.width * decoded.height * 4);
    }
    checks.push(`Packaged image conversion to ${format}`);
  }
  const pdf = path.join(folder, 'input.pdf');
  await fs.copyFile(path.join(appRoot, 'samples/Readme.pdf'), pdf);
  const pages = await convert({ paths: [pdf], format: 'png', outputDir: folder });
  assert.ok(pages.length > 0);
  for (const page of pages) {
    assert.equal(page.error, undefined);
    assert.equal((await sharp(page.path).metadata()).format, 'png');
  }
  checks.push('Packaged PDF rendering');
  const audio = path.join(folder, 'tone.wav');
  await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', audio]);
  const result = await convert({ paths: [audio], format: 'mp3', outputDir: folder });
  assert.equal(result[0].error, undefined);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', result[0].path, '-f', 'null', '-']);
  checks.push('Bundled FFmpeg audio conversion and decoding');
  const video = path.join(folder, 'input.mp4');
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=12', '-t', '0.25', '-c:v', 'libx264', video]);
  for (const format of ['webm', 'gif']) {
    const [output] = await convert({ paths: [video], format, outputDir: folder });
    assert.equal(output.error, undefined);
    await run(ffmpeg, ['-v', 'error', '-i', output.path, '-f', 'null', '-']);
  }
  checks.push('Bundled video encoders and output decoding');
  assert.equal(await hash(original), before);
  checks.push('Original image preserved');
  const evidence = { pass: true, runtime: process.versions.electron, node: process.versions.node, arch: process.arch, checks };
  await fs.writeFile(path.join(folder, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
