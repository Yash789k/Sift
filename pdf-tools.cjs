'use strict';
const fs = require('node:fs/promises');
const { PDFDocument, PDFName, PDFDict, degrees, rgb, pushGraphicsState, popGraphicsState,
  concatTransformationMatrix, drawObject } = require('pdf-lib');
const { image, loadPdf, renderPdfPage, checkAbort } = require('./engine.cjs')._internals;
const MAX_PAGES = 300;
const SAVE = { useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false };
const FLATTEN_NOTE = 'All pages are flattened into images. Selectable text, links, forms, bookmarks and document metadata are not retained.';

function number(value, fallback, min, max, label, integer = false) {
  const n = value == null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`${label} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
  return n;
}
function color(value = '#000000') {
  if (typeof value !== 'string' || !/^#[a-f\d]{6}$/i.test(value)) throw new Error('Choose a valid color.');
  return rgb(...[1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255));
}
function xml(text) { return String(text).replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' })[c]); }
function selection(options, width, height) {
  const rect = { left: number(options.left, 0, 0, width - 1, 'Left'), top: number(options.top, 0, 0, height - 1, 'Top'),
    width: number(options.width, width, 1, width, 'Width'), height: number(options.height, height, 1, height, 'Height') };
  if (rect.left + rect.width > width || rect.top + rect.height > height) throw new Error('The selection extends beyond this page.');
  return rect;
}
function geometry(page) {
  const viewport = page.getViewport({ scale: 1 });
  const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
  if (!(width > 0 && height > 0 && width <= 16000 && height <= 16000 && width * height <= 20000000)) throw new Error('This PDF page is too large to edit.');
  return { viewport, width, height, point: (x, y) => viewport.convertToPdfPoint(x * viewport.width / width, y * viewport.height / height) };
}
async function read(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 250 * 1024 * 1024) throw new Error('Choose a PDF smaller than 250 MB.');
  const bytes = await fs.readFile(file);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (!doc.getPageCount() || doc.getPageCount() > MAX_PAGES) throw new Error(`Edit PDFs with 1 to ${MAX_PAGES} pages.`);
  return { bytes, doc };
}
async function inspectPdf(file, requested = 1) {
  const { doc, bytes } = await read(file);
  const pageNumber = number(requested, 1, 1, doc.getPageCount(), 'Page', true);
  const pdf = await loadPdf(bytes);
  try {
    const page = await pdf.getPage(pageNumber);
    const { width, height } = geometry(page);
    const metadata = [{ label: 'Pages', value: String(doc.getPageCount()) }];
    for (const [label, getter] of [['Title','getTitle'],['Author','getAuthor'],['Subject','getSubject'],['Keywords','getKeywords'],['Creator','getCreator'],['Producer','getProducer'],['Created','getCreationDate'],['Modified','getModificationDate']]) {
      try { const value = doc[getter](); if (value) metadata.push({ label, value: value instanceof Date ? value.toISOString() : String(value).slice(0, 1000) }); } catch {}
    }
    page.cleanup();
    return { width, height, page: pageNumber, pages: doc.getPageCount(), metadata,
      metadataNote: 'Removes document properties and embedded XMP. Visible content, comments and attachment contents are not removed.' };
  } finally { await pdf.destroy(); }
}
function stripMetadata(doc) {
  const info = doc.context.trailerInfo.Info;
  delete doc.context.trailerInfo.Info; delete doc.context.trailerInfo.ID;
  if (info) doc.context.delete(info);
  const remove = new Set();
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFDict ? object : object.dict;
    if (!(dict instanceof PDFDict)) continue;
    const metadata = dict.get(PDFName.of('Metadata'));
    if (metadata) { remove.add(metadata); dict.delete(PDFName.of('Metadata')); }
    if (dict.get(PDFName.of('Type')) === PDFName.of('Metadata')) remove.add(ref);
  }
  for (const ref of remove) doc.context.delete(ref);
}
async function overlay(doc, page, geom, options) {
  if (typeof options.text !== 'string' || !options.text.trim() || options.text.length > 2000) throw new Error('Enter annotation text between 1 and 2,000 characters.');
  const x = number(options.x, 24, 0, geom.width - 1, 'X'), y = number(options.y, 24, 0, geom.height - 1, 'Y');
  const fontSize = number(options.fontSize, 24, 8, 500, 'Font size');
  const ink = options.color || '#191919'; color(ink);
  const lines = options.text.split('\n');
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${geom.width}" height="${geom.height}"><text x="${x}" y="${y + fontSize}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${ink}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? fontSize * 1.2 : 0}">${xml(line)}</tspan>`).join('')}</text></svg>`;
  // Render only the added annotation; existing PDF text remains untouched.
  const png = await image(Buffer.from(markup)).png().toBuffer();
  const embedded = await doc.embedPng(png);
  const origin = geom.point(0, geom.height), right = geom.point(geom.width, geom.height), top = geom.point(0, 0);
  const name = page.node.newXObject('SiftAnnotation', embedded.ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(right[0]-origin[0], right[1]-origin[1], top[0]-origin[0], top[1]-origin[1], ...origin), drawObject(name), popGraphicsState());
}
async function framedPage(doc, page, geom, options, index) {
  const padding = number(options.padding, 36, 0, 500, 'Padding');
  const fill = color(options.background || '#e2cfff');
  const [left, bottom, right, top] = geom.viewport.viewBox;
  const box = { x: left, y: bottom, width: right - left, height: top - bottom }, rotation = geom.viewport.rotation;
  const embedded = page.node.Contents() ? await doc.embedPage(page, { left, bottom, right, top }) : null;
  const scale = geom.viewport.width / (rotation % 180 ? box.height : box.width);
  const next = doc.insertPage(index, [geom.viewport.width + padding * 2, geom.viewport.height + padding * 2]);
  next.drawRectangle({ x: 0, y: 0, width: next.getWidth(), height: next.getHeight(), color: fill });
  if (embedded) next.drawPage(embedded, { x: padding + (rotation === 180 ? box.width : rotation === 270 ? box.height : 0) * scale,
    y: padding + (rotation === 90 ? box.width : rotation === 180 ? box.height : 0) * scale,
    xScale: scale, yScale: scale, rotate: degrees(-rotation) });
  doc.removePage(index + 1);
}
async function applyPdfTool(file, tool, options = {}, signal, progress, preview = false) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid PDF options.');
  const { bytes, doc: source } = await read(file);
  const selected = number(options.page, 1, 1, source.getPageCount(), 'Page', true) - 1;
  checkAbort(signal);
  if (tool === 'metadata') {
    if (options.action && options.action !== 'remove') throw new Error('Choose Remove metadata.');
    stripMetadata(source);
    return { data: Buffer.from(await source.save(SAVE)), format: 'pdf', pages: source.getPageCount() };
  }
  if (tool === 'compress' && (options.pdfMode || 'compact') === 'compact') {
    const compact = Buffer.from(await source.save(SAVE));
    return { data: compact.length < bytes.length ? compact : bytes, format: 'pdf', pages: source.getPageCount(),
      ...(compact.length >= bytes.length ? { warning: 'This PDF is already compact. A copy was saved without reducing image quality.' } : {}) };
  }
  const raster = tool === 'redact' || tool === 'compress';
  if (tool === 'compress' && options.pdfMode !== 'raster') throw new Error('Choose compact or flattened PDF compression.');
  if (!['compress','redact','crop','edit','annotate','background'].includes(tool)) throw new Error('Choose a supported PDF tool.');
  let output = source;
  if (raster || preview) output = await PDFDocument.create({ updateMetadata: false });
  if (preview && !raster) output.addPage((await output.copyPages(source, [selected]))[0]);
  const pdf = await loadPdf(bytes);
  const indices = preview ? [selected] : raster || options.allPages === true ? source.getPageIndices() : [selected];
  let warning;
  try {
    for (const index of indices) {
      checkAbort(signal);
      const pdfPage = await pdf.getPage(index + 1);
      try {
        const geom = geometry(pdfPage), page = raster ? null : output.getPage(preview ? 0 : index);
        if (raster) {
          const maxSize = number(options.maxSize, 1800, 256, 4000, 'Longest edge', true);
          const scale = tool === 'redact' ? 2 : Math.min(2, maxSize / Math.max(geom.width, geom.height));
          const rendered = await renderPdfPage(pdfPage, scale);
          let pipeline = image(rendered.data);
          if (tool === 'redact' && index === selected) {
            const regions = options.regions || [options];
            if (!Array.isArray(regions) || !regions.length || regions.length > 100) throw new Error('Choose between 1 and 100 redaction areas.');
            const patches = [];
            for (const entry of regions) {
              if (!entry || typeof entry !== 'object' || (entry.mode && entry.mode !== 'solid')) throw new Error('PDF redaction uses solid removal; blur is not permanent redaction.');
              const rect = selection(entry, geom.width, geom.height);
              const left = Math.floor(rect.left * rendered.width / geom.width), top = Math.floor(rect.top * rendered.height / geom.height);
              const width = Math.min(rendered.width, Math.ceil((rect.left + rect.width) * rendered.width / geom.width)) - left;
              const height = Math.min(rendered.height, Math.ceil((rect.top + rect.height) * rendered.height / geom.height)) - top;
              const ink = entry.color || '#191919'; color(ink);
              patches.push({ input: await require('sharp')({ create: { width, height, channels: 3, background: ink } }).png().toBuffer(), left, top });
            }
            pipeline = pipeline.composite(patches);
          }
          const data = await (tool === 'compress' ? pipeline.jpeg({ quality: number(options.quality, 70, 1, 100, 'Quality', true) }) : pipeline.png()).toBuffer();
          checkAbort(signal);
          const embedded = tool === 'compress' ? await output.embedJpg(data) : await output.embedPng(data);
          const next = output.addPage([geom.viewport.width, geom.viewport.height]);
          next.drawImage(embedded, { x: 0, y: 0, width: next.getWidth(), height: next.getHeight() });
          warning = tool === 'redact' ? `Solid redaction applied permanently. ${FLATTEN_NOTE}` : FLATTEN_NOTE;
        } else if (tool === 'crop') {
          const rect = selection(options, geom.width, geom.height);
          const corners = [geom.point(rect.left, rect.top), geom.point(rect.left + rect.width, rect.top + rect.height)];
          const x = Math.min(...corners.map(p => p[0])), y = Math.min(...corners.map(p => p[1]));
          page.setCropBox(x, y, Math.abs(corners[0][0] - corners[1][0]), Math.abs(corners[0][1] - corners[1][1]));
          warning = 'Cropping changes the visible page area; it does not permanently remove hidden content. Use Redact for removal.';
        } else if (tool === 'edit') {
          const rotation = number(options.rotate, 0, 0, 270, 'Rotation', true);
          if (![0,90,180,270].includes(rotation)) throw new Error('Choose a quarter-turn rotation.');
          const scale = number(options.scalePercent, 100, 10, 200, 'Scale') / 100;
          const boxes = ['MediaBox','CropBox','BleedBox','TrimBox','ArtBox'].map(name => [name, page[`get${name}`]()]);
          page.scaleContent(scale, scale); page.scaleAnnotations(scale, scale);
          for (const [name, box] of boxes) page[`set${name}`](box.x * scale, box.y * scale, box.width * scale, box.height * scale);
          page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
        } else if (tool === 'annotate') await overlay(output, page, geom, options);
        else if (tool === 'background') {
          await framedPage(output, page, geom, options, preview ? 0 : index);
          warning = 'Text stays selectable. Links and interactive fields on framed pages are not retained.';
        }
        progress?.({ source: file, page: index + 1, pages: pdf.numPages, status: 'page-complete' });
      } finally { pdfPage.cleanup(); }
    }
    checkAbort(signal);
    const data = Buffer.from(await output.save(SAVE));
    if (tool === 'compress' && data.length >= bytes.length && !preview) warning = `${FLATTEN_NOTE} This copy is not smaller; the original remains unchanged.`;
    return { data, format: 'pdf', pages: output.getPageCount(), warning };
  } finally { await pdf.destroy(); }
}
async function previewPdfTool(file, tool, options) {
  let data, pageNumber = options?.page || 1;
  if (tool === 'compress' && (options?.pdfMode || 'compact') === 'compact') data = (await read(file)).bytes;
  else { data = (await applyPdfTool(file, tool, options, undefined, undefined, true)).data; pageNumber = 1; }
  const pdf = await loadPdf(data);
  try {
    const page = await pdf.getPage(pageNumber);
    try { return `data:image/png;base64,${(await renderPdfPage(page, 1)).data.toString('base64')}`; }
    finally { page.cleanup(); }
  } finally { await pdf.destroy(); }
}
module.exports = { inspectPdf, applyPdfTool, previewPdfTool, FLATTEN_NOTE };
