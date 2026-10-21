'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

// Do not retain open source-file handles in libvips' operation cache. Windows
// users should be able to move or rename an input immediately after conversion.
sharp.cache(false);

let ffmpeg;
try { ffmpeg = require('ffmpeg-static'); } catch { ffmpeg = null; }

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'tif', 'tiff', 'gif', 'svg', 'bmp', 'heic', 'heif']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aif', 'aiff']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpeg', 'mpg', 'wmv']);
const IMAGE_OUTPUT = new Set(['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif', 'bmp', 'heic']);
const AUDIO_OUTPUT = new Set(['mp3', 'wav', 'm4a', 'flac', 'ogg']);
const VIDEO_OUTPUT = new Set(['mp4', 'webm', 'gif']);
const MAX_IMAGE_PIXELS = 100_000_000;
const MAX_BATCH = 100;
const MAX_PDF_BYTES = 250 * 1024 * 1024;

function getCapabilities() {
  return {
    image: [...IMAGE_OUTPUT, 'pdf', 'docx'],
    audio: ffmpeg ? [...AUDIO_OUTPUT] : [],
    video: ffmpeg ? ['mp4', 'webm', 'mp3', 'wav', 'm4a', 'gif'] : [],
    pdf: ['png', 'jpeg', 'txt', 'docx', 'pdf'],
    actions: ['resize', 'crop', 'merge-pdf', 'compress', 'metadata', 'edit', 'annotate', 'background', 'redact'],
    ffmpeg: Boolean(ffmpeg),
    maxBatch: MAX_BATCH,
    imageInputs: [...IMAGE_EXT],
    audioInputs: [...AUDIO_EXT],
    videoInputs: [...VIDEO_EXT],
  };
}

function checkAbort(signal) {
  if (signal?.aborted) throw new Error('Conversion cancelled.');
}

function normalizePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('Choose at least one file.');
  if (paths.length > MAX_BATCH) throw new Error(`Choose up to ${MAX_BATCH} files at a time.`);
  return [...new Set(paths.map((file) => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) {
      throw new Error('Each input must be an absolute local file path.');
    }
    return path.normalize(file);
  }))];
}

function kindFor(ext) {
  if (IMAGE_EXT.has(ext)) return 'image';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return 'unsupported';
}

function image(file, options = {}) {
  return sharp(file, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error', ...options });
}

async function decodedInput(source) {
  if (typeof source !== 'string') return source;
  const extension = path.extname(source).toLowerCase();
  if (!['.heic', '.heif', '.bmp'].includes(extension)) return source;
  const stat = await fs.stat(source);
  if (stat.size > MAX_PDF_BYTES) throw new Error('This image must be smaller than 250 MB.');
  const buffer = await fs.readFile(source);
  if (extension === '.bmp') {
    if (buffer.length < 54 || buffer.toString('ascii', 0, 2) !== 'BM') throw new Error('This BMP file is damaged.');
    const width = Math.abs(buffer.readInt32LE(18)), height = Math.abs(buffer.readInt32LE(22));
    if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error('This image exceeds the 100-megapixel safety limit.');
    const decoded = require('bmp-js').decode(buffer);
    // bmp-js returns ABGR; sharp takes RGBA.
    const rgba = Buffer.alloc(decoded.width * decoded.height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = decoded.data[i + 3]; rgba[i + 1] = decoded.data[i + 2];
      rgba[i + 2] = decoded.data[i + 1]; rgba[i + 3] = 255;
    }
    return image(rgba, { raw: { width: decoded.width, height: decoded.height, channels: 4 } }).png().toBuffer();
  }
  const images = await require('heic-decode').all({ buffer });
  try {
    const first = images[0];
    if (!first || first.width * first.height > MAX_IMAGE_PIXELS) throw new Error('This image exceeds the 100-megapixel safety limit.');
    const decoded = await first.decode();
    return image(Buffer.from(decoded.data), { raw: { width: decoded.width, height: decoded.height, channels: 4 } }).png().toBuffer();
  } finally { images.dispose(); }
}

function encodeBmp(data, width, height) {
  const stride = Math.ceil(width * 3 / 4) * 4;
  const result = Buffer.alloc(54 + stride * height);
  result.write('BM'); result.writeUInt32LE(result.length, 2); result.writeUInt32LE(54, 10);
  result.writeUInt32LE(40, 14); result.writeInt32LE(width, 18); result.writeInt32LE(-height, 22);
  result.writeUInt16LE(1, 26); result.writeUInt16LE(24, 28); result.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (y * width + x) * 3, dest = 54 + y * stride + x * 3;
    result[dest] = data[src + 2]; result[dest + 1] = data[src + 1]; result[dest + 2] = data[src];
  }
  return result;
}

function encodeHeic(data, info, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const pixels = Uint8Array.from(data);
    const worker = new Worker(path.join(__dirname, 'heic-worker.cjs'), {
      workerData: { pixels: pixels.buffer, width: info.width, height: info.height }, transferList: [pixels.buffer],
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      worker.terminate().finally(() => error ? reject(error) : resolve(result));
    };
    const abort = () => finish(new Error('Conversion cancelled.'));
    const timer = setTimeout(() => finish(new Error('HEIC encoding took too long. Try resizing this image first.')), 120000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', message => finish(message.error ? new Error(message.error) : null, message.data && Buffer.from(message.data)));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`HEIC encoder stopped unexpectedly (${code}).`)); });
    if (signal?.aborted) abort();
  });
}

function readableError(error) {
  const message = String(error?.message || error);
  if (/ENOENT/.test(message)) return 'The file could not be found. It may have moved.';
  if (/EACCES|EPERM/.test(message)) return 'Sift does not have permission to read or write this location.';
  if (/ENOSPC/.test(message)) return 'There is not enough free space to save this file.';
  if (/Input image exceeds pixel limit/.test(message)) return 'This image exceeds the 100-megapixel safety limit.';
  if (/unsupported image format|corrupt header|bad seek|premature end|VipsJpeg/.test(message)) {
    return 'This image is damaged or uses an unsupported encoding.';
  }
  return message.replace(/\r/g, '').slice(0, 600);
}

function orientedDimensions(meta) {
  const swap = [5, 6, 7, 8].includes(meta.orientation);
  const width = meta.width;
  const height = meta.pageHeight || meta.height;
  return swap ? { width: height, height: width } : { width, height };
}

async function inspectOne(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const result = { path: file, name: path.basename(file), ext, kind: kindFor(ext), size: 0 };
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('Folders are not supported. Choose individual files.');
    result.size = stat.size;
    if (result.kind === 'image') {
      const input = await decodedInput(file);
      const meta = await image(input).metadata();
      Object.assign(result, orientedDimensions(meta), { pages: meta.pages || 1, hasAlpha: Boolean(meta.hasAlpha) });
      const thumbnail = await image(input).rotate().resize(240, 160, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      result.thumbnail = `data:image/png;base64,${thumbnail.toString('base64')}`;
    } else if (result.kind === 'pdf') {
      if (stat.size > MAX_PDF_BYTES) throw new Error('PDFs must be smaller than 250 MB.');
      const doc = await PDFDocument.load(await fs.readFile(file));
      result.pages = doc.getPageCount();
      if (!result.pages) throw new Error('This PDF contains no pages.');
    } else if (result.kind === 'unsupported') {
      result.error = 'This file type is not supported. Try an image, audio, video, or PDF file.';
    }
  } catch (error) {
    result.error = readableError(error);
  }
  return result;
}

async function inspectFiles(paths) {
  const files = normalizePaths(paths);
  const results = new Array(files.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < files.length) {
      const index = cursor++;
      results[index] = await inspectOne(files[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  return results;
}

async function previewFile(filePath) {
  const [file] = normalizePaths([filePath]);
  if (kindFor(path.extname(file).slice(1).toLowerCase()) !== 'image') {
    throw new Error('Image previews are available for supported image files.');
  }
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('Choose an image file, not a folder.');
    const preview = await image(await decodedInput(file)).rotate()
      .resize(1200, 800, { fit: 'inside', withoutEnlargement: true })
      .png().toBuffer();
    return `data:image/png;base64,${preview.toString('base64')}`;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

function positiveDimension(value, field) {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 16000) {
    throw new Error(`${field} must be a whole number between 1 and 16,000 pixels.`);
  }
  return number;
}

function normalizedOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid conversion options.');
  const quality = options.quality == null ? 85 : Number(options.quality);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error('Quality must be between 1 and 100.');
  const result = {
    quality,
    width: positiveDimension(options.width, 'Width'),
    height: positiveDimension(options.height, 'Height'),
    fit: 'inside',
  };
  if (options.crop != null) {
    const crop = options.crop;
    if (!crop || typeof crop !== 'object') throw new Error('Choose a valid crop area.');
    for (const field of ['left', 'top', 'width', 'height']) {
      if (!Number.isInteger(crop[field]) || crop[field] < (field === 'left' || field === 'top' ? 0 : 1)) {
        throw new Error('The crop area must use whole pixels and have a positive size.');
      }
    }
    result.crop = { left: crop.left, top: crop.top, width: crop.width, height: crop.height };
  }
  return result;
}

async function makeImagePipeline(source, options, format) {
  const input = await decodedInput(source);
  const meta = await image(input).metadata();
  const dimensions = orientedDimensions(meta);
  if (options.crop && (
    options.crop.left + options.crop.width > dimensions.width ||
    options.crop.top + options.crop.height > dimensions.height
  )) throw new Error('The crop area extends beyond this image.');

  // Use an oriented intermediate for crop coordinates: previews and crops share the
  // same coordinate space even when the original carries EXIF rotation metadata.
  let pipeline;
  if (options.crop) {
    const oriented = await image(input).rotate().png().toBuffer();
    pipeline = image(oriented).extract(options.crop);
  } else {
    // Preserve animation for GIF/WebP output. Other formats use the first frame.
    const animated = meta.pages > 1 && ['gif', 'webp'].includes(format);
    pipeline = image(input, animated ? { animated: true } : {}).rotate();
  }
  if (options.width || options.height) {
    pipeline = pipeline.resize(options.width, options.height, { fit: 'inside', withoutEnlargement: true });
  }
  if (format === 'jpeg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: options.quality, mozjpeg: true });
  if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9 });
  if (format === 'webp') pipeline = pipeline.webp({ quality: options.quality });
  if (format === 'avif') pipeline = pipeline.avif({ quality: options.quality, effort: 4 });
  if (format === 'tiff') pipeline = pipeline.tiff({ compression: 'lzw' });
  if (format === 'gif') pipeline = pipeline.gif({ effort: 3 });
  return { pipeline, meta };
}

async function outputFolder(source, outputDir) {
  const folder = outputDir == null || outputDir === '' ? path.dirname(source) : outputDir;
  if (typeof folder !== 'string' || !path.isAbsolute(folder) || folder.includes('\0')) {
    throw new Error('Choose an absolute output folder path.');
  }
  const stat = await fs.stat(folder);
  if (!stat.isDirectory()) throw new Error('Choose a folder for the converted files.');
  return folder;
}

async function publish(temp, folder, stem, extension) {
  // COPYFILE_EXCL makes collision handling safe even when two conversion jobs
  // finish simultaneously or another application creates a matching file.
  for (let number = 1; number < 10000; number++) {
    const suffix = number === 1 ? '' : ` (${number})`;
    const destination = path.join(folder, `${stem}${suffix}.${extension}`);
    try {
      await fs.copyFile(temp, destination, constants.COPYFILE_EXCL);
      return destination;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Too many files already have this name. Choose another output folder.');
}

function tempPath(folder, extension) {
  return path.join(folder, `.sift-${crypto.randomUUID()}.${extension}`);
}

async function finalResult(source, destination, extra = {}) {
  const stat = await fs.stat(destination);
  return { source, path: destination, name: path.basename(destination), size: stat.size, ...extra };
}

async function convertImage(file, format, outputDir, options, signal) {
  const folder = await outputFolder(file, outputDir);
  const extension = format === 'jpeg' ? 'jpg' : format;
  const temp = tempPath(folder, extension);
  try {
    checkAbort(signal);
    const { pipeline, meta } = await makeImagePipeline(file, options, format);
    let info;
    if (format === 'heic') {
      // This codec uses its balanced quality preset; transparency is matted white.
      const pixels = await pipeline.flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      info = pixels.info;
      await fs.writeFile(temp, await encodeHeic(pixels.data, info, signal));
    } else if (format === 'bmp') {
      const pixels = await pipeline.flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      info = pixels.info;
      await fs.writeFile(temp, encodeBmp(pixels.data, info.width, info.height));
    } else info = await pipeline.toFile(temp);
    checkAbort(signal);
    const destination = await publish(temp, folder, `${path.parse(file).name}-converted`, extension);
    const warning = meta.pages > 1 && (options.crop || !['gif', 'webp'].includes(format))
      ? 'Only the first frame or page was converted.' : undefined;
    return finalResult(file, destination, { width: info.width, height: info.pageHeight || info.height, ...(warning ? { warning } : {}) });
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}

async function convertImageDocx(file, outputDir, options, signal) {
  const folder = await outputFolder(file, outputDir);
  const temp = tempPath(folder, 'docx');
  try {
    const { pipeline } = await makeImagePipeline(file, options, 'png');
    const data = await pipeline.png().toBuffer();
    const meta = await image(data).metadata();
    const scale = Math.min(600 / meta.width, 780 / meta.height, 1);
    const { Document, Paragraph, ImageRun, Packer } = require('docx');
    const doc = new Document({ creator: 'Sift', sections: [{ properties: {}, children: [new Paragraph({
      children: [new ImageRun({ type: 'png', data, transformation: { width: Math.round(meta.width * scale), height: Math.round(meta.height * scale) } })],
    })] }] });
    await fs.writeFile(temp, await Packer.toBuffer(doc));
    checkAbort(signal);
    const destination = await publish(temp, folder, `${path.parse(file).name}-converted`, 'docx');
    return finalResult(file, destination, { pages: 1, warning: 'The image is embedded in a Word document. Image text is not converted to editable text.' });
  } finally { await fs.unlink(temp).catch(() => {}); }
}

function runFfmpeg(args, signal, onProgress) {
  return new Promise((resolve, reject) => {
    checkAbort(signal);
    if (!ffmpeg) return reject(new Error('The offline media converter is not installed.'));
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', ...args], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errors = '';
    let progress = '';
    let settled = false;
    let cancelled = false;
    let killTimer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => {
      cancelled = true;
      child.kill();
      // Wait for the process to release its output file before cleanup on Windows.
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      killTimer.unref();
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr.on('data', (chunk) => { errors = (errors + chunk.toString()).slice(-16000); });
    child.stdout.on('data', (chunk) => {
      progress += chunk.toString();
      const lines = progress.split('\n');
      progress = lines.pop();
      for (const line of lines) {
        if (line.startsWith('out_time_us=')) onProgress?.({ seconds: Number(line.slice(12)) / 1_000_000 });
      }
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (cancelled) return finish(new Error('Conversion cancelled.'));
      if (code === 0) return finish();
      const hint = /does not contain any stream|matches no streams/.test(errors) ? 'The selected file does not contain the required audio or video stream.'
        : /Invalid data found|moov atom not found|Error opening input/.test(errors) ? 'This media file is damaged or uses an unsupported encoding.'
          : /Permission denied/.test(errors) ? 'Sift does not have permission to write in this folder.'
            : /No space left/.test(errors) ? 'There is not enough free space to save this file.'
              : `Media conversion failed. ${errors.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`;
      finish(new Error(hint));
    });
  });
}

async function convertMedia(file, kind, format, outputDir, options, signal, onProgress) {
  if (!ffmpeg) throw new Error('The offline media converter is not installed.');
  if (!AUDIO_OUTPUT.has(format) && !(kind === 'video' && VIDEO_OUTPUT.has(format))) {
    throw new Error(`Converting ${kind} to ${format.toUpperCase()} is not supported.`);
  }
  const folder = await outputFolder(file, outputDir);
  const temp = tempPath(folder, format);
  const args = ['-i', file];
  if (AUDIO_OUTPUT.has(format)) {
    args.push('-map', '0:a:0', '-vn');
    if (format === 'mp3') args.push('-c:a', 'libmp3lame', '-q:a', '2');
    if (format === 'wav') args.push('-c:a', 'pcm_s16le');
    if (format === 'm4a') args.push('-c:a', 'aac', '-b:a', '192k');
    if (format === 'flac') args.push('-c:a', 'flac');
    if (format === 'ogg') args.push('-c:a', 'libvorbis', '-q:a', '5');
  } else if (format === 'gif') {
    args.push('-an', '-filter_complex',
      '[0:v:0]fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse[out]',
      '-map', '[out]', '-loop', '0');
  } else {
    args.push('-map', '0:v:0', '-map', '0:a:0?');
    // Pad odd source dimensions instead of cropping away content.
    args.push('-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2');
    if (format === 'mp4') args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart');
    if (format === 'webm') args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus');
  }
  args.push('-map_metadata', '-1', '-progress', 'pipe:1', temp);
  try {
    await runFfmpeg(args, signal, onProgress);
    checkAbort(signal);
    const destination = await publish(temp, folder, `${path.parse(file).name}-converted`, format);
    return finalResult(file, destination);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}

async function createPdf(items, outputDir, options, signal, onProgress) {
  const first = items[0].path;
  const folder = await outputFolder(first, outputDir);
  const temp = tempPath(folder, 'pdf');
  const doc = await PDFDocument.create();
  const failures = [];
  const sources = [];
  let firstFrameOnly = false;
  try {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      checkAbort(signal);
      onProgress?.({ index, total: items.length, source: item.path, status: 'converting' });
      try {
        if (item.error) throw new Error(item.error);
        if (item.kind === 'pdf') {
          const sourceDoc = await PDFDocument.load(await fs.readFile(item.path));
          const pages = await doc.copyPages(sourceDoc, sourceDoc.getPageIndices());
          for (const page of pages) doc.addPage(page);
        } else if (item.kind === 'image') {
          if (item.pages > 1) firstFrameOnly = true;
          const { pipeline } = await makeImagePipeline(item.path, options, 'png');
          const png = await pipeline.png().toBuffer();
          const embedded = await doc.embedPng(png);
          // Scale pixels to points at 96 dpi, bounded by PDF's common page limit.
          const scale = Math.min(0.75, 14400 / Math.max(embedded.width, embedded.height));
          const page = doc.addPage([embedded.width * scale, embedded.height * scale]);
          page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
        } else {
          throw new Error('PDF creation accepts images and existing PDFs.');
        }
        sources.push(item.path);
      } catch (error) {
        failures.push({ source: item.path, name: item.name, error: readableError(error) });
      }
    }
    checkAbort(signal);
    if (!sources.length) return failures;
    await fs.writeFile(temp, await doc.save());
    const stem = `${path.parse(first).name}-${items.length > 1 ? 'combined' : 'converted'}`;
    const destination = await publish(temp, folder, stem, 'pdf');
    const result = await finalResult(first, destination, {
      pages: doc.getPageCount(), sources,
      ...(firstFrameOnly ? { warning: 'Animated or multi-page images use their first frame or page in PDFs.' } : {}),
    });
    onProgress?.({ index: items.length, total: items.length, status: 'complete', result });
    return [result, ...failures];
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}

let pdfLibrary;
async function loadPdf(file) {
  if (!pdfLibrary) {
    const canvas = require('@napi-rs/canvas');
    for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) if (!globalThis[name]) globalThis[name] = canvas[name];
    pdfLibrary = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  const pdfjs = await pdfLibrary;
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  return pdfjs.getDocument({
    data: new Uint8Array(await fs.readFile(file)), isEvalSupported: false,
    standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep,
    cMapUrl: path.join(root, 'cmaps') + path.sep, cMapPacked: true,
    useSystemFonts: false, disableFontFace: true,
  }).promise;
}

async function renderPdfPage(page, scale = 2) {
  const base = page.getViewport({ scale: 1 });
  const safeScale = Math.min(scale, Math.sqrt(20_000_000 / (base.width * base.height)));
  const viewport = page.getViewport({ scale: safeScale });
  const canvas = require('@napi-rs/canvas').createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  try {
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
    return { data: await canvas.encode('png'), width: canvas.width, height: canvas.height };
  } finally { canvas.width = 1; canvas.height = 1; }
}

function textLines(content) {
  const lines = []; let line = '', lastY;
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform?.[5];
    if (line && Number.isFinite(y) && Number.isFinite(lastY) && Math.abs(y - lastY) > 2) { lines.push(line.trim()); line = ''; }
    line += (line && !/\s$/.test(line) && item.str && !/^\s/.test(item.str) ? ' ' : '') + item.str;
    lastY = y;
    if (item.hasEOL) { lines.push(line.trim()); line = ''; lastY = undefined; }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

async function convertPdf(file, format, outputDir, signal, onProgress) {
  const folder = await outputFolder(file, outputDir);
  const document = await loadPdf(file);
  const results = [], sections = [], texts = [];
  let scanned = false;
  try {
    if (document.numPages > 300) throw new Error('Export PDFs with up to 300 pages at a time.');
    for (let index = 1; index <= document.numPages; index++) {
      checkAbort(signal);
      const page = await document.getPage(index);
      try {
        if (format === 'png' || format === 'jpeg') {
          const rendered = await renderPdfPage(page);
          const extension = format === 'jpeg' ? 'jpg' : 'png';
          const temp = tempPath(folder, extension);
          try {
            if (format === 'jpeg') await image(rendered.data).jpeg({ quality: 92, mozjpeg: true }).toFile(temp);
            else await fs.writeFile(temp, rendered.data);
            checkAbort(signal);
            const dest = await publish(temp, folder, `${path.parse(file).name}-page-${String(index).padStart(3, '0')}`, extension);
            results.push(await finalResult(file, dest, { width: rendered.width, height: rendered.height, page: index, pages: document.numPages }));
            onProgress?.({ page: index, pages: document.numPages, source: file, status: 'page-complete' });
          } finally { await fs.unlink(temp).catch(() => {}); }
        } else {
          const lines = textLines(await page.getTextContent());
          texts.push(lines.join('\n'));
          if (format === 'docx') {
            const { Paragraph, TextRun, ImageRun } = require('docx');
            let children;
            if (lines.some(line => line.trim())) children = lines.map(line => new Paragraph({ children: [new TextRun(line)] }));
            else {
              scanned = true;
              const rendered = await renderPdfPage(page, 1.5);
              const ratio = Math.min(600 / rendered.width, 800 / rendered.height, 1);
              children = [new Paragraph({ children: [new ImageRun({ type: 'png', data: rendered.data,
                transformation: { width: Math.round(rendered.width * ratio), height: Math.round(rendered.height * ratio) } })] })];
            }
            sections.push({ properties: {}, children });
          }
        }
      } finally { page.cleanup(); }
    }
    if (format === 'txt' || format === 'docx') {
      if (format === 'txt' && !texts.some(text => text.trim())) throw new Error('This PDF contains scanned images without selectable text. OCR is not available offline in this version. Export PNG or JPG instead.');
      const temp = tempPath(folder, format);
      try {
        if (format === 'txt') await fs.writeFile(temp, texts.join('\n\n\f\n\n'), 'utf8');
        else {
          const { Document, Packer } = require('docx');
          await fs.writeFile(temp, await Packer.toBuffer(new Document({ sections, creator: 'Sift' })));
        }
        checkAbort(signal);
        const dest = await publish(temp, folder, `${path.parse(file).name}-converted`, format);
        const warning = format === 'txt' ? 'Extracted selectable text; page layout and image-only text are not retained.'
          : scanned ? 'Selectable text is editable. Scanned pages are embedded as images; OCR was not applied.'
            : 'Extracted text is editable; complex PDF columns, images and layout are not reconstructed.';
        results.push(await finalResult(file, dest, { pages: document.numPages, warning }));
      } finally { await fs.unlink(temp).catch(() => {}); }
    }
    return results;
  } catch (error) {
    // A later page may fail or the user may cancel after earlier pages were
    // published. Preserve those visible results instead of orphaning outputs.
    if (results.length) return [...results, { source: file, name: path.basename(file), error: readableError(error) }];
    throw error;
  } finally { await document.destroy(); }
}

async function convert(request, onProgress, signal) {
  if (!request || typeof request !== 'object') throw new Error('Invalid conversion request.');
  const paths = normalizePaths(request.paths);
  const format = String(request.format || '').toLowerCase().replace(/^jpg$/, 'jpeg').replace(/^tif$/, 'tiff');
  if (![...IMAGE_OUTPUT, ...AUDIO_OUTPUT, ...VIDEO_OUTPUT, 'pdf', 'txt', 'docx'].includes(format)) {
    throw new Error('Choose a supported output format.');
  }
  const options = normalizedOptions(request.options);
  const items = await inspectFiles(paths);
  checkAbort(signal);
  if (format === 'pdf') return createPdf(items, request.outputDir, options, signal, onProgress);
  const results = [];
  const cancelledRemainder = index => [
    ...results,
    ...items.slice(index).map(item => ({ source: item.path, name: item.name, error: 'Conversion cancelled.' })),
  ];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (signal?.aborted && results.length) return cancelledRemainder(index);
    checkAbort(signal);
    onProgress?.({ index, total: items.length, source: item.path, status: 'converting' });
    try {
      if (item.error) throw new Error(item.error);
      let result;
      if (item.kind === 'image' && IMAGE_OUTPUT.has(format)) {
        result = await convertImage(item.path, format, request.outputDir, options, signal);
      } else if (item.kind === 'image' && format === 'docx') {
        result = await convertImageDocx(item.path, request.outputDir, options, signal);
      } else if (item.kind === 'pdf' && ['png', 'jpeg', 'txt', 'docx'].includes(format)) {
        result = await convertPdf(item.path, format, request.outputDir, signal, onProgress);
      } else if (item.kind === 'audio' || item.kind === 'video') {
        result = await convertMedia(item.path, item.kind, format, request.outputDir, options, signal,
          (progress) => onProgress?.({ ...progress, index, total: items.length, source: item.path, status: 'converting' }));
      } else {
        throw new Error(`Converting ${item.kind} files to ${format.toUpperCase()} is not supported.`);
      }
      results.push(...(Array.isArray(result) ? result : [result]));
      onProgress?.({ index: index + 1, total: items.length, source: item.path, status: 'complete', result });
    } catch (error) {
      if (signal?.aborted) {
        if (results.length) return cancelledRemainder(index);
        throw error;
      }
      const result = { source: item.path, name: item.name, error: readableError(error) };
      results.push(result);
      onProgress?.({ index: index + 1, total: items.length, source: item.path, status: 'error', result });
    }
  }
  return results;
}

module.exports = { getCapabilities, inspectFiles, previewFile, convert,
  _internals: { image, decodedInput, orientedDimensions, normalizePaths, checkAbort, outputFolder, publish, tempPath, finalResult, readableError } };
