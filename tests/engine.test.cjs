'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const ffmpeg = require('ffmpeg-static');
const { convert, inspectFiles, previewFile, getCapabilities } = require('../engine.cjs');

const exec = promisify(execFile);
const workspace = path.resolve(process.env.SIFT_TEST_ROOT || path.join(os.tmpdir(), 'sift-tests'));
let dir;
let original;
let originalHash;
let video;
let audio;

async function hash(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function decodeMedia(file) {
  await exec(ffmpeg, ['-hide_banner', '-v', 'error', '-i', file, '-f', 'null', '-'], { windowsHide: true });
}

test.before(async () => {
  await fs.mkdir(workspace, { recursive: true });
  dir = await fs.mkdtemp(path.join(workspace, 'sift-engine-test-'));
  original = path.join(dir, 'Test image_日本語 café.png');
  const pixels = Buffer.alloc(96 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 96; x++) {
      const i = (y * 96 + x) * 4;
      pixels[i] = x < 48 ? 255 : 0;
      pixels[i + 1] = x >= 48 ? 255 : 0;
      pixels[i + 2] = y >= 32 ? 255 : 0;
      pixels[i + 3] = 255;
    }
  }
  await sharp(pixels, { raw: { width: 96, height: 64, channels: 4 } }).png().toFile(original);
  originalHash = await hash(original);
  audio = path.join(dir, 'tone.wav');
  video = path.join(dir, 'motion.mp4');
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.6', audio], { windowsHide: true });
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=96x64:rate=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '0.6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', video], { windowsHide: true });
});

test.after(async () => {
  if (dir) {
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(workspace) + path.sep) && path.basename(resolved).startsWith('sift-engine-test-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test('inspection returns oriented dimensions, real thumbnail, and honest unsupported-file errors', async () => {
  const unsupported = path.join(dir, 'notes.txt');
  await fs.writeFile(unsupported, 'Not an image');
  const [info, bad, folder] = await inspectFiles([original, unsupported, dir]);
  assert.equal(info.kind, 'image');
  assert.equal(info.width, 96);
  assert.equal(info.height, 64);
  assert.ok(info.thumbnail.startsWith('data:image/png;base64,'));
  const thumb = await sharp(Buffer.from(info.thumbnail.split(',')[1], 'base64')).metadata();
  assert.equal(thumb.format, 'png');
  assert.match(bad.error, /not supported/);
  assert.match(folder.error, /Folders are not supported/);
});

test('editor previews are bounded, oriented PNGs that do not enlarge originals', async () => {
  const large = path.join(dir, 'preview-large.jpg');
  await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#df712b' } })
    .jpeg().withMetadata({ orientation: 6 }).toFile(large);
  const encoded = await previewFile(large);
  assert.ok(encoded.startsWith('data:image/png;base64,'));
  const dimensions = await sharp(Buffer.from(encoded.split(',')[1], 'base64')).metadata();
  assert.equal(dimensions.format, 'png');
  assert.equal(dimensions.width, 450);
  assert.equal(dimensions.height, 800);
  const small = await previewFile(original);
  const smallDimensions = await sharp(Buffer.from(small.split(',')[1], 'base64')).metadata();
  assert.equal(smallDimensions.width, 96);
  assert.equal(smallDimensions.height, 64);
  await assert.rejects(previewFile(audio), /supported image files/);
});

test('all six image outputs are real decodable files and preserve the original', async () => {
  for (const format of ['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif']) {
    const [result] = await convert({ paths: [original], format });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(result.size > 0);
    assert.notEqual(result.path, original);
    const info = await sharp(result.path).metadata();
    assert.equal(info.width, 96);
    assert.equal(info.height, 64);
    assert.equal(info.format, format === 'avif' ? 'heif' : format);
    await sharp(result.path).raw().toBuffer();
  }
  assert.equal(await hash(original), originalHash);
});

test('output collisions produce distinct files without replacing existing contents', async () => {
  const [first] = await convert({ paths: [original], format: 'png' });
  const firstHash = await hash(first.path);
  const [second] = await convert({ paths: [original], format: 'png' });
  assert.notEqual(first.path, second.path);
  assert.equal(await hash(first.path), firstHash);
  assert.equal(await hash(original), originalHash);
});

test('concurrent conversions cannot overwrite each other', async () => {
  const results = await Promise.all(Array.from({ length: 3 }, () => convert({ paths: [original], format: 'webp' })));
  const paths = results.map(([result]) => result.path);
  assert.equal(new Set(paths).size, 3);
  for (const output of paths) assert.ok((await fs.stat(output)).size > 0);
});

test('resize retains aspect ratio and does not enlarge', async () => {
  const [small] = await convert({ paths: [original], format: 'png', options: { width: 48, height: 48 } });
  assert.equal(small.width, 48);
  assert.equal(small.height, 32);
  const [large] = await convert({ paths: [original], format: 'png', options: { width: 1000 } });
  assert.equal(large.width, 96);
  assert.equal(large.height, 64);
});

test('crop returns the requested pixels and exact dimensions', async () => {
  const [result] = await convert({
    paths: [original], format: 'png', options: { crop: { left: 48, top: 0, width: 48, height: 32 } },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.width, 48);
  assert.equal(result.height, 32);
  const { data, info } = await sharp(result.path).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([...data.subarray(0, 3)], [0, 255, 0]);
  assert.equal(info.width, 48);
  const [resizedCrop] = await convert({
    paths: [original], format: 'png', options: { crop: { left: 48, top: 0, width: 48, height: 32 }, width: 24, height: 24 },
  });
  assert.equal(resizedCrop.width, 24);
  assert.equal(resizedCrop.height, 16);
  const croppedPixels = await sharp(resizedCrop.path).raw().toBuffer();
  assert.deepEqual([...croppedPixels.subarray(0, 3)], [0, 255, 0]);
});

test('EXIF orientation uses the same dimensions for preview and crop', async () => {
  const rotated = path.join(dir, 'rotated.jpg');
  await sharp(original).jpeg().withMetadata({ orientation: 6 }).toFile(rotated);
  const [inspected] = await inspectFiles([rotated]);
  assert.equal(inspected.width, 64);
  assert.equal(inspected.height, 96);
  const [result] = await convert({ paths: [rotated], format: 'png', options: { crop: { left: 0, top: 0, width: 64, height: 40 } } });
  assert.equal(result.error, undefined);
  assert.equal(result.width, 64);
  assert.equal(result.height, 40);
});

test('transparent images become a white matte in JPEG output', async () => {
  const transparent = path.join(dir, 'transparent.png');
  await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(transparent);
  const [result] = await convert({ paths: [transparent], format: 'jpeg' });
  const pixels = await sharp(result.path).raw().toBuffer();
  assert.ok(pixels[0] > 250 && pixels[1] > 250 && pixels[2] > 250);
});

test('SVG source is rasterized with the expected dimensions and pixel color', async () => {
  const vector = path.join(dir, 'vector.svg');
  await fs.writeFile(vector, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#ff6600"/></svg>');
  const [result] = await convert({ paths: [vector], format: 'png' });
  assert.equal(result.error, undefined);
  assert.equal(result.width, 100);
  assert.equal(result.height, 50);
  const pixels = await sharp(result.path).raw().toBuffer();
  assert.deepEqual([...pixels.subarray(0, 3)], [255, 102, 0]);
});

test('invalid options and out-of-bounds crop fail clearly without output', async () => {
  await assert.rejects(convert({ paths: [original], format: 'png', options: { width: -1 } }), /Width/);
  await assert.rejects(convert({ paths: [original], format: 'png', options: { quality: 101 } }), /Quality/);
  await assert.rejects(convert({ paths: [original], format: '../../bad' }), /supported output/);
  const [crop] = await convert({ paths: [original], format: 'png', options: { crop: { left: 90, top: 0, width: 20, height: 10 } } });
  assert.match(crop.error, /beyond/);
  assert.equal(crop.path, undefined);
});

test('mixed-validity batch preserves successes and reports per-file failures', async () => {
  const corrupt = path.join(dir, 'damaged.png');
  await fs.writeFile(corrupt, 'damaged image');
  const events = [];
  const results = await convert({ paths: [original, corrupt, path.join(dir, 'missing.png')], format: 'webp' }, event => events.push(event));
  assert.ok(results[0].path);
  assert.ok(results[1].error);
  assert.match(results[2].error, /could not be found/);
  assert.equal(events.filter(event => event.status === 'complete').length, 1);
  assert.equal(events.filter(event => event.status === 'error').length, 2);
});

test('image PDF preserves page order and dimensions; PDF merge retains all pages', async () => {
  const second = path.join(dir, 'portrait.png');
  await sharp({ create: { width: 30, height: 60, channels: 3, background: '#2255aa' } }).png().toFile(second);
  const [imagePdf] = await convert({ paths: [original, second], format: 'pdf' });
  assert.equal(imagePdf.error, undefined);
  let document = await PDFDocument.load(await fs.readFile(imagePdf.path));
  assert.equal(document.getPageCount(), 2);
  assert.deepEqual(document.getPages().map(page => [page.getWidth(), page.getHeight()]), [[72, 48], [22.5, 45]]);
  const [onePage] = await convert({ paths: [second], format: 'pdf' });
  const [merged] = await convert({ paths: [imagePdf.path, onePage.path], format: 'pdf' });
  document = await PDFDocument.load(await fs.readFile(merged.path));
  assert.equal(document.getPageCount(), 3);
  assert.deepEqual(document.getPages().map(page => [page.getWidth(), page.getHeight()]), [[72, 48], [22.5, 45], [22.5, 45]]);
});

test('malformed PDF does not prevent a valid image being saved in a batch', async () => {
  const malformed = path.join(dir, 'malformed.pdf');
  await fs.writeFile(malformed, '%PDF-broken');
  const results = await convert({ paths: [original, malformed], format: 'pdf' });
  assert.ok(results[0].path);
  assert.equal(results[0].pages, 1);
  assert.ok(results[1].error);
});

test('all audio outputs decode fully with the offline media engine', async () => {
  assert.equal(getCapabilities().ffmpeg, true);
  for (const format of ['mp3', 'wav', 'm4a', 'flac', 'ogg']) {
    const [result] = await convert({ paths: [audio], format });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(result.size > 100);
    await decodeMedia(result.path);
  }
});

test('video MP4/WebM/GIF outputs and extracted audio decode fully', async () => {
  for (const format of ['mp4', 'webm', 'gif', 'mp3']) {
    const [result] = await convert({ paths: [video], format });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(result.size > 100);
    await decodeMedia(result.path);
    if (format === 'gif') assert.ok((await sharp(result.path).metadata()).pages > 1);
  }
});

test('silent video gives a useful error for audio extraction', async () => {
  const silent = path.join(dir, 'silent.mp4');
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=0.2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent], { windowsHide: true });
  const [result] = await convert({ paths: [silent], format: 'mp3' });
  assert.match(result.error, /required audio or video stream/);
});

test('animated GIF remains animated in WebP and warns for a static output', async () => {
  const [gif] = await convert({ paths: [video], format: 'gif' });
  const [webp] = await convert({ paths: [gif.path], format: 'webp' });
  assert.equal(webp.error, undefined);
  assert.ok((await sharp(webp.path).metadata()).pages > 1);
  const [png] = await convert({ paths: [gif.path], format: 'png' });
  assert.equal(png.error, undefined);
  assert.match(png.warning, /first frame/);
  assert.equal((await sharp(png.path).metadata()).pages || 1, 1);
  const [pdf] = await convert({ paths: [gif.path], format: 'pdf' });
  assert.equal(pdf.error, undefined);
  assert.equal(pdf.pages, 1);
  assert.match(pdf.warning, /first frame or page/);
});

test('cancelling an active media job releases and removes the temporary output', async () => {
  const longVideo = path.join(dir, 'long-video.mp4');
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30',
    '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', longVideo], { windowsHide: true });
  const controller = new AbortController();
  let timer;
  const result = convert({ paths: [longVideo], format: 'webm' }, event => {
    if (event.status === 'converting' && !timer) timer = setTimeout(() => controller.abort(), 100);
  }, controller.signal);
  await assert.rejects(result, /cancelled/);
  clearTimeout(timer);
  assert.equal((await fs.readdir(dir)).filter(name => name.startsWith('.sift-')).length, 0);
  assert.equal((await fs.readdir(dir)).filter(name => name.startsWith('long-video-converted')).length, 0);
});

test('pre-cancelled jobs never publish output and leave no temporary files', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(convert({ paths: [original], format: 'png' }, undefined, controller.signal), /cancelled/);
  assert.equal((await fs.readdir(dir)).filter(name => name.startsWith('.sift-')).length, 0);
});

test('cancelling a batch keeps already-published results visible to the caller', async () => {
  const second = path.join(dir, 'cancel-batch-second.png');
  await fs.copyFile(original, second);
  const controller = new AbortController();
  const results = await convert({ paths: [original, second], format: 'webp' }, event => {
    if (event.status === 'complete') controller.abort();
  }, controller.signal);
  assert.equal(results.length, 2);
  assert.ok(results[0].path);
  assert.ok((await fs.stat(results[0].path)).size > 0);
  assert.equal(results[1].source, second);
  assert.match(results[1].error, /cancelled/);
  assert.equal((await fs.readdir(dir)).filter(name => name.startsWith('cancel-batch-second-converted')).length, 0);
});
