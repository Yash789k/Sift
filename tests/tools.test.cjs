'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { inspectTools, runTool, previewTool } = require('../tools-engine.cjs');
const { convert, inspectFiles } = require('../engine.cjs');
let dir, original, originalHash, pdf;
const workspace = path.resolve(process.env.SIFT_TEST_ROOT || path.join(os.tmpdir(), 'sift-tests'));
const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function pixels(file) { return sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true }); }
const at = (image, x, y) => [...image.data.subarray((y * image.info.width + x) * image.info.channels, (y * image.info.width + x) * image.info.channels + 3)];
async function tool(tool, options) { const [result] = await runTool({ paths: [original], tool, options }); assert.equal(result.error, undefined, JSON.stringify(result)); return result; }

test.before(async () => {
  await fs.mkdir(workspace, { recursive: true });
  dir = await fs.mkdtemp(path.join(workspace, 'sift-tools-test-'));
  original = path.join(dir, 'Original_日本語.png');
  const data = Buffer.alloc(120 * 80 * 3);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) { const i = (y * 120 + x) * 3; data[i] = x < 60 ? 255 : 0; data[i + 1] = x >= 60 ? 255 : 0; data[i + 2] = y >= 40 ? 255 : 0; }
  await sharp(data, { raw: { width: 120, height: 80, channels: 3 } }).png().withExif({ IFD0: { Artist: 'Sift Test', Copyright: 'Private metadata' } }).toFile(original);
  originalHash = await hash(original);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [index, color] of [rgb(1,0,0), rgb(0,0,1)].entries()) {
    const page = doc.addPage([200, 100]);
    page.drawRectangle({ x: 0, y: 0, width: 200, height: 100, color });
    page.drawText(`Page ${index + 1} editable text`, { x: 10, y: 50, size: 12, font, color: rgb(1,1,1) });
  }
  pdf = path.join(dir, 'Text document.pdf'); await fs.writeFile(pdf, await doc.save());
});
test.after(async () => {
  assert.equal(await hash(original), originalHash);
  const resolved = path.resolve(dir);
  assert.ok(resolved.startsWith(workspace + path.sep) && path.basename(resolved).startsWith('sift-tools-test-'));
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3 });
});

test('metadata inspector reads EXIF and removal creates a pixel-identical metadata-free copy', async () => {
  const info = await inspectTools(original);
  assert.ok(info.metadata.some(item => item.label === 'Artist' && item.value === 'Sift Test'));
  assert.equal(info.tools.length, 7);
  const result = await tool('metadata', { action: 'remove' });
  const metadata = await sharp(result.path).metadata();
  assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined);
  assert.deepEqual((await pixels(result.path)).data, (await pixels(original)).data);
});

test('crop uses selected original pixels; edit rotation and horizontal flip transform content', async () => {
  const crop = await tool('crop', { left: 60, top: 0, width: 60, height: 40 });
  assert.equal(crop.width, 60); assert.equal(crop.height, 40);
  assert.deepEqual(at(await pixels(crop.path), 10, 10), [0, 255, 0]);
  const edit = await tool('edit', { rotate: 90 });
  assert.equal(edit.width, 80); assert.equal(edit.height, 120);
  assert.deepEqual(at(await pixels(edit.path), 10, 10), [255, 0, 255]);
  const flipped = await tool('edit', { flop: true });
  assert.deepEqual(at(await pixels(flipped.path), 10, 10), [0, 255, 0]);
});

test('solid redaction overwrites exactly the selected rectangle and strips metadata', async () => {
  const result = await tool('redact', { left: 5, top: 5, width: 30, height: 20 });
  const image = await pixels(result.path);
  assert.deepEqual(at(image, 10, 10), [0,0,0]);
  assert.deepEqual(at(image, 40, 10), [255,0,0]);
  assert.equal((await sharp(result.path).metadata()).exif, undefined);
});

test('blur redaction changes mixed-color pixels while keeping pixels outside the area', async () => {
  const result = await tool('redact', { left: 40, top: 20, width: 40, height: 40, mode: 'blur' });
  const image = await pixels(result.path);
  const center = at(image, 59, 39);
  assert.ok(center[0] > 30 && center[0] < 230 && center[1] > 30 && center[2] > 30);
  assert.deepEqual(at(image, 10, 10), [255,0,0]);
});

test('annotation draws typed vector shapes and safely escaped text', async () => {
  const result = await tool('annotate', { annotations: [{ shape:'rectangle',x:10,y:10,width:30,height:25,color:'#ffffff',strokeWidth:4 }, { text:'<safe & text>', x:2,y:45,fontSize:10,color:'#ffffff' }] });
  const image = await pixels(result.path);
  assert.deepEqual(at(image, 10, 15), [255,255,255]);
  assert.deepEqual(at(image, 100, 10), [0,255,0]);
});

test('background uses actual canvas ratio, padding, rounded corners and gradient pixels', async () => {
  const solid = await tool('background', { background:'#123456',padding:20,corners:10,shadow:0,ratio:'1:1' });
  assert.equal(solid.width, 160); assert.equal(solid.height, 160);
  const image = await pixels(solid.path);
  assert.deepEqual(at(image, 0, 0), [18,52,86]);
  assert.deepEqual(at(image, 20, 40), [18,52,86]);
  assert.deepEqual(at(image, 40, 60), [255,0,0]);
  const gradient = await tool('background', { background:'sunset',padding:20,corners:10,shadow:30,ratio:'16:9' });
  assert.ok(Math.abs(gradient.width / gradient.height - 16/9) < 0.01);
  const grad = await pixels(gradient.path);
  assert.notDeepEqual(at(grad,0,0), at(grad,grad.info.width-1,grad.info.height-1));
});

test('compression emits a real chosen codec with bounded dimensions and reports actual saved bytes', async () => {
  const result = await tool('compress', { format:'webp',quality:50,maxSize:60 });
  assert.equal(result.width, 60); assert.equal(result.height, 40);
  assert.equal((await sharp(result.path).metadata()).format, 'webp');
  assert.equal(result.savedBytes, (await fs.stat(original)).size - result.size);
});

test('tool preview matches saved geometry; collisions and invalid selections preserve files', async () => {
  const options = { background:'peach',padding:20,corners:0,shadow:0,ratio:'1:1' };
  const preview = await previewTool({ path:original,tool:'background',options });
  assert.equal((await sharp(Buffer.from(preview.split(',')[1], 'base64')).metadata()).width,160);
  const one = await tool('background', options), before = await hash(one.path), two = await tool('background', options);
  assert.notEqual(one.path,two.path); assert.equal(await hash(one.path),before);
  const [bad] = await runTool({ paths:[original],tool:'redact',options:{left:110,top:0,width:30,height:20} });
  assert.match(bad.error,/beyond/); assert.equal(bad.path,undefined);
});

test('BMP output has correct signature, dimensions and RGB roundtrip including row padding', async () => {
  const [result] = await convert({ paths:[original],format:'bmp',options:{width:117} });
  assert.equal(result.error,undefined);
  const encoded = await fs.readFile(result.path);
  assert.equal(encoded.toString('ascii',0,2),'BM'); assert.equal(encoded.readInt32LE(18),117);
  const [info] = await inspectFiles([result.path]); assert.equal(info.width,117); assert.equal(info.error,undefined);
  const [back] = await convert({paths:[result.path],format:'png'});
  assert.deepEqual(at(await pixels(back.path),10,10),[255,0,0]);
});

test('HEIC output is independently decodable, keeps odd dimensions, and preserves source pixels approximately', async () => {
  const [result] = await convert({ paths:[original],format:'heic',options:{width:117} });
  assert.equal(result.error,undefined,JSON.stringify(result));
  const encoded=await fs.readFile(result.path);
  assert.equal(encoded.toString('ascii',4,8),'ftyp');
  assert.ok(['heic','mif1','heix'].includes(encoded.toString('ascii',8,12)));
  const decoded=await require('heic-decode')({buffer:encoded});
  assert.equal(decoded.width,117); assert.equal(decoded.height,78);
  const p=(10*decoded.width+10)*4;
  assert.ok(decoded.data[p]>230 && decoded.data[p+1]<25 && decoded.data[p+2]<25);
  const [back]=await convert({paths:[result.path],format:'png'});
  assert.equal(back.error,undefined); assert.equal(back.width,117);
});

test('cancelling HEIC encoding leaves no converted or temporary file', async () => {
  const controller=new AbortController();
  let timer;
  const promise=convert({paths:[original],format:'heic'},event=>{
    if(event.status==='converting') timer=setTimeout(()=>controller.abort(),10);
  },controller.signal);
  await assert.rejects(promise,/cancelled/); clearTimeout(timer);
  assert.equal((await fs.readdir(dir)).filter(name=>name.startsWith('.sift-')).length,0);
});

test('PDF PNG/JPG render every page with correct ordering, pixels and real signatures', async () => {
  for (const format of ['png','jpeg']) {
    const results = await convert({paths:[pdf],format});
    assert.equal(results.length,2); assert.equal(results[0].error,undefined,JSON.stringify(results));
    assert.equal(results[0].width,400); assert.equal(results[0].height,200);
    const red=at(await pixels(results[0].path),2,2),blue=at(await pixels(results[1].path),2,2);
    assert.ok(red[0]>240 && red[2]<10); assert.ok(blue[2]>240 && blue[0]<10);
    assert.equal((await sharp(results[0].path).metadata()).format,format);
  }
});

test('PDF TXT and DOCX contain actual selectable text in page order', async () => {
  const [txt] = await convert({paths:[pdf],format:'txt'}); assert.equal(txt.error,undefined,JSON.stringify(txt));
  const text = await fs.readFile(txt.path,'utf8'); assert.match(text,/Page 1 editable text/); assert.match(text,/Page 2 editable text/);
  assert.ok(text.indexOf('Page 1')<text.indexOf('Page 2'));
  const [docx] = await convert({paths:[pdf],format:'docx'}); assert.equal(docx.error,undefined,JSON.stringify(docx));
  const zip = await require('jszip').loadAsync(await fs.readFile(docx.path));
  const xml=await zip.file('word/document.xml').async('string');
  assert.match(xml,/Page 1 editable text/); assert.match(xml,/Page 2 editable text/); assert.match(docx.warning,/layout/);
});

test('cancelled multi-page PDF export returns already-published pages and cleans temporary files', async () => {
  const controller=new AbortController();
  const results=await convert({paths:[pdf],format:'png'},event=>{
    if(event.status==='page-complete' && event.page===1) controller.abort();
  },controller.signal);
  assert.equal(results.length,2); assert.equal(results[0].page,1); assert.ok(results[0].path);
  assert.match(results[1].error,/cancelled/); assert.ok((await fs.stat(results[0].path)).size>0);
  assert.equal((await fs.readdir(dir)).filter(name=>name.startsWith('.sift-')).length,0);
});

test('image DOCX embeds the original image pixels and honestly identifies non-editable image text', async () => {
  const [result]=await convert({paths:[original],format:'docx'});
  assert.equal(result.error,undefined,JSON.stringify(result));
  const zip=await require('jszip').loadAsync(await fs.readFile(result.path));
  const name=Object.keys(zip.files).find(name=>/^word\/media\/.*\.png$/.test(name));
  assert.ok(name);
  const embedded=await zip.file(name).async('nodebuffer');
  assert.deepEqual(await sharp(embedded).removeAlpha().raw().toBuffer(),(await pixels(original)).data);
  assert.match(result.warning,/not converted to editable text/);
});

test('scanned PDF refuses empty TXT and creates DOCX with real embedded page images', async () => {
  const [scanned] = await convert({paths:[original],format:'pdf'});
  const [txt] = await convert({paths:[scanned.path],format:'txt'}); assert.match(txt.error,/OCR is not available/);
  const [docx] = await convert({paths:[scanned.path],format:'docx'}); assert.equal(docx.error,undefined,JSON.stringify(docx));
  const zip = await require('jszip').loadAsync(await fs.readFile(docx.path));
  assert.ok(Object.keys(zip.files).some(name=>/^word\/media\/.*\.png$/.test(name))); assert.match(docx.warning,/embedded as images/);
});
