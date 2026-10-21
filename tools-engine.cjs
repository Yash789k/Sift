'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { inspectFiles, _internals } = require('./engine.cjs');
const { image, decodedInput, normalizePaths, checkAbort, outputFolder, publish, tempPath, finalResult, readableError } = _internals;

const TOOLS = ['compress', 'metadata', 'edit', 'annotate', 'background', 'crop', 'redact'];
const PRESETS = {
  sunset: ['#ffbd8a', '#f06e9c'], ocean: ['#9bdef5', '#4f73dc'], lavender: ['#e2cfff', '#b6abf7'],
  mint: ['#c8f5dc', '#6bc6b0'], peach: ['#ffe3c5', '#f5b69d'], midnight: ['#27385d', '#101528'],
};

function number(value, fallback, min, max, label, integer = false) {
  const result = value == null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) {
    throw new Error(`${label} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
  }
  return result;
}
function color(value, fallback = '#000000') {
  const result = value || fallback;
  if (typeof result !== 'string' || !/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(result)) throw new Error('Choose a valid hexadecimal color.');
  return result;
}
function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}
function svg(width, height, content) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`);
}
function region(options, width, height) {
  const left = number(options.left ?? options.x, 0, 0, width - 1, 'Left', true);
  const top = number(options.top ?? options.y, 0, 0, height - 1, 'Top', true);
  const w = number(options.width, width, 1, width, 'Width', true);
  const h = number(options.height, height, 1, height, 'Height', true);
  if (left + w > width || top + h > height) throw new Error('The selected area extends beyond this image.');
  return { left, top, width: w, height: h };
}
function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid tool options.');
  return options;
}

async function inspectTools(value) {
  const multiple = Array.isArray(value);
  const files = await inspectFiles(multiple ? value : [value]);
  const results = [];
  for (const file of files) {
    const metadata = [{ label: 'File name', value: file.name }, { label: 'File size', value: `${file.size.toLocaleString('en-US')} bytes` },
      { label: 'Format', value: file.ext.toUpperCase() }];
    if (file.width) metadata.push({ label: 'Dimensions', value: `${file.width} × ${file.height} px` });
    if (file.kind === 'image' && !file.error) {
      let exif;
      try { exif = await require('exifr').parse(file.path, { tiff: true, exif: true, gps: true, iptc: true, xmp: true }); } catch {}
      if (exif) for (const [label, value] of Object.entries(exif).slice(0, 150)) {
        if (value == null || ArrayBuffer.isView(value) || typeof value === 'object' && !(value instanceof Date)) continue;
        metadata.push({ label, value: (value instanceof Date ? value.toISOString() : String(value)).slice(0, 500) });
      }
    }
    results.push({ ...file, metadata, tools: file.kind === 'image' && !file.error ? TOOLS : [],
      metadataNote: 'Removing metadata creates a new image without EXIF, GPS, IPTC or XMP. The original stays unchanged.' });
  }
  return multiple ? results : results[0];
}

async function applyTool(file, tool, supplied = {}) {
  if (!TOOLS.includes(tool)) throw new Error('Choose a supported image tool.');
  const options = validateOptions(supplied);
  const input = await decodedInput(file);
  const meta = await image(input).metadata();
  // Editor controls and selections share one auto-oriented, first-frame space.
  const oriented = await image(input).rotate().png().toBuffer();
  const dimensions = await image(oriented).metadata();
  const { width, height } = dimensions;
  let pipeline = image(oriented);
  let outputFormat = 'png';
  const warning = meta.pages > 1 ? 'This editor saves the first frame or page only.' : undefined;

  if (tool === 'crop') {
    pipeline = pipeline.extract(region(options.crop || options, width, height));
  } else if (tool === 'edit') {
    const angle = number(options.rotate, 0, 0, 270, 'Rotation', true);
    if (![0, 90, 180, 270].includes(angle)) throw new Error('Rotation must be 0, 90, 180 or 270 degrees.');
    if (angle) pipeline = pipeline.rotate(angle);
    if (options.flip) pipeline = pipeline.flip();
    if (options.flop) pipeline = pipeline.flop();
    const brightness = number(options.brightness, 1, 0.1, 3, 'Brightness');
    const saturation = number(options.saturation, 1, 0, 3, 'Saturation');
    pipeline = pipeline.modulate({ brightness, saturation });
    if (options.width || options.height) pipeline = pipeline.resize(
      options.width ? number(options.width, width, 1, 16000, 'Width', true) : undefined,
      options.height ? number(options.height, height, 1, 16000, 'Height', true) : undefined,
      { fit: 'inside', withoutEnlargement: true });
  } else if (tool === 'compress') {
    const quality = number(options.quality, 75, 1, 100, 'Quality', true);
    const requested = String(options.format || meta.format).replace('jpg', 'jpeg');
    outputFormat = ['png', 'jpeg', 'webp', 'avif'].includes(requested) ? requested : 'webp';
    if (options.maxSize) {
      const maxSize = number(options.maxSize, 1600, 1, 16000, 'Maximum size', true);
      pipeline = pipeline.resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true });
    }
    if (outputFormat === 'png') pipeline = pipeline.png({ palette: true, quality, compressionLevel: 8, effort: 3 });
    if (outputFormat === 'jpeg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true });
    if (outputFormat === 'webp') pipeline = pipeline.webp({ quality, effort: 3 });
    if (outputFormat === 'avif') pipeline = pipeline.avif({ quality, effort: 3 });
  } else if (tool === 'metadata') {
    if (options.action && options.action !== 'remove') throw new Error('Use inspectTools to view metadata, or remove to save a stripped copy.');
    // Sharp omits source metadata by default. PNG avoids a second lossy encode.
  } else if (tool === 'annotate') {
    const annotations = options.annotations || [options];
    if (!Array.isArray(annotations) || !annotations.length || annotations.length > 100) throw new Error('Add between 1 and 100 annotations.');
    let markup = '';
    for (const entry of annotations) {
      validateOptions(entry);
      const x = number(entry.x, Math.min(24, width - 1), 0, width, 'X');
      const y = number(entry.y, Math.min(24, height - 1), 0, height, 'Y');
      const ink = color(entry.color, '#ff5533');
      const stroke = number(entry.strokeWidth, 4, 1, 100, 'Stroke width');
      if (entry.shape) {
        const w = number(entry.width, Math.min(100, width - x), 1, width, 'Shape width');
        const h = number(entry.height, Math.min(60, height - y), 1, height, 'Shape height');
        if (x + w > width || y + h > height) throw new Error('The annotation extends beyond this image.');
        if (entry.shape === 'rectangle') markup += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${ink}" stroke-width="${stroke}"/>`;
        else if (entry.shape === 'ellipse') markup += `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="none" stroke="${ink}" stroke-width="${stroke}"/>`;
        else if (entry.shape === 'arrow') {
          const angle = Math.atan2(h, w), size = Math.max(12, stroke * 3), ex = x + w, ey = y + h;
          const a = `${ex - size * Math.cos(angle - 0.5)},${ey - size * Math.sin(angle - 0.5)}`;
          const b = `${ex - size * Math.cos(angle + 0.5)},${ey - size * Math.sin(angle + 0.5)}`;
          markup += `<path d="M${x},${y} L${ex},${ey} M${a} L${ex},${ey} L${b}" fill="none" stroke="${ink}" stroke-width="${stroke}" stroke-linecap="round"/>`;
        } else throw new Error('Choose rectangle, ellipse or arrow.');
      } else {
        if (typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 2000) throw new Error('Enter annotation text between 1 and 2,000 characters.');
        const size = number(entry.fontSize, 32, 8, 500, 'Font size');
        const lines = entry.text.split('\n');
        markup += `<text x="${x}" y="${y + size}" font-family="Arial, sans-serif" font-weight="600" font-size="${size}" fill="${ink}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? size * 1.2 : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`;
      }
    }
    pipeline = pipeline.composite([{ input: svg(width, height, markup) }]);
  } else if (tool === 'redact') {
    const selections = options.regions || [options];
    if (!Array.isArray(selections) || !selections.length || selections.length > 100) throw new Error('Choose between 1 and 100 areas.');
    const composites = [];
    for (const selection of selections) {
      validateOptions(selection);
      const rect = region(selection, width, height);
      if (selection.mode === 'blur') {
        const blurred = await image(oriented).extract(rect).blur(Math.max(10, Math.min(rect.width, rect.height) / 6)).png().toBuffer();
        composites.push({ input: blurred, left: rect.left, top: rect.top });
      } else if (!selection.mode || selection.mode === 'solid') {
        composites.push({ input: svg(rect.width, rect.height, `<rect width="100%" height="100%" fill="${color(selection.color)}"/>`), left: rect.left, top: rect.top });
      } else throw new Error('Choose solid or blur redaction.');
    }
    pipeline = pipeline.composite(composites);
  } else if (tool === 'background') {
    const padding = number(options.padding, 80, 0, 500, 'Padding', true);
    const radius = Math.min(number(options.corners, 24, 0, 500, 'Corner radius'), width / 2, height / 2);
    const shadow = number(options.shadow, 30, 0, 100, 'Shadow');
    let w = width + padding * 2, h = height + padding * 2;
    const ratios = { '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '3:2': 1.5 };
    const ratio = options.ratio || 'auto';
    if (ratio !== 'auto') {
      if (!ratios[ratio]) throw new Error('Choose a supported background aspect ratio.');
      if (w / h < ratios[ratio]) w = Math.ceil(h * ratios[ratio]); else h = Math.ceil(w / ratios[ratio]);
    }
    if (w * h > 100_000_000 || w > 20000 || h > 20000) throw new Error('The framed image is too large. Reduce padding or image dimensions.');
    const left = Math.floor((w - width) / 2), top = Math.floor((h - height) / 2);
    const background = options.background || 'lavender';
    const gradient = PRESETS[background];
    const fill = gradient ? 'url(#background)' : color(background);
    const definition = gradient ? `<defs><linearGradient id="background" x1="0%" y1="0%" x2="100%" y2="100%"><stop stop-color="${gradient[0]}"/><stop offset="1" stop-color="${gradient[1]}"/></linearGradient></defs>` : '';
    const bg = svg(w, h, `${definition}<rect width="100%" height="100%" fill="${fill}"/>`);
    const rounded = await image(oriented).ensureAlpha().composite([{ input: svg(width, height,
      `<rect width="100%" height="100%" rx="${radius}" fill="white"/>`), blend: 'dest-in' }]).png().toBuffer();
    const layers = [];
    if (shadow) {
      const shadowSvg = svg(w, h, `<rect x="${left}" y="${top + Math.round(shadow / 5)}" width="${width}" height="${height}" rx="${radius}" fill="black" fill-opacity="${shadow / 200}"/>`);
      const shadowPng = await image(shadowSvg).blur(Math.max(0.3, shadow / 3)).png().toBuffer();
      layers.push({ input: shadowPng });
    }
    layers.push({ input: rounded, left, top });
    pipeline = image(bg).composite(layers);
  }
  const data = await (tool === 'compress' ? pipeline : pipeline.png({ compressionLevel: 6 })).toBuffer();
  const info = await image(data).metadata();
  return { data, format: outputFormat, width: info.width, height: info.height, warning };
}

async function previewTool(request) {
  const [file] = normalizePaths([request?.path || request?.paths?.[0]]);
  const processed = await applyTool(file, request.tool, request.options);
  const data = await image(processed.data).resize(1200, 800, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  return `data:image/png;base64,${data.toString('base64')}`;
}

async function runTool(request, onProgress, signal) {
  if (!request || !TOOLS.includes(request.tool)) throw new Error('Choose a supported image tool.');
  const files = normalizePaths(request.paths);
  const results = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (signal?.aborted && results.length) return [...results, ...files.slice(index).map(source => ({ source, name: path.basename(source), error: 'Conversion cancelled.' }))];
    checkAbort(signal);
    let temp;
    try {
      onProgress?.({ index, total: files.length, source: file, status: 'converting' });
      const [inspected] = await inspectFiles([file]);
      if (inspected.error) throw new Error(inspected.error);
      if (inspected.kind !== 'image') throw new Error('This tool works with image files.');
      const processed = await applyTool(file, request.tool, request.options);
      checkAbort(signal);
      const folder = await outputFolder(file, request.outputDir);
      const ext = processed.format === 'jpeg' ? 'jpg' : processed.format;
      temp = tempPath(folder, ext);
      await fs.writeFile(temp, processed.data);
      checkAbort(signal);
      const destination = await publish(temp, folder, `${path.parse(file).name}-${request.tool === 'metadata' ? 'metadata-removed' : request.tool}`, ext);
      const result = await finalResult(file, destination, { width: processed.width, height: processed.height,
        originalSize: inspected.size, savedBytes: inspected.size - processed.data.length,
        ...(processed.warning ? { warning: processed.warning } : {}) });
      results.push(result);
      onProgress?.({ index: index + 1, total: files.length, source: file, status: 'complete', result });
    } catch (error) {
      if (signal?.aborted) {
        if (!results.length) throw error;
        return [...results, ...files.slice(index).map(source => ({ source, name: path.basename(source), error: 'Conversion cancelled.' }))];
      }
      const result = { source: file, name: path.basename(file), error: readableError(error) };
      results.push(result);
      onProgress?.({ index: index + 1, total: files.length, source: file, status: 'error', result });
    } finally { if (temp) await fs.unlink(temp).catch(() => {}); }
  }
  return results;
}

module.exports = { inspectTools, runTool, previewTool, getToolCapabilities: () => ({ tools: TOOLS, backgroundPresets: Object.keys(PRESETS) }) };
