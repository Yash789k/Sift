'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {PDFDocument,PDFName,PDFString,rgb,degrees}=require('pdf-lib'),sharp=require('sharp');
const {inspectTools,runTool,previewTool}=require('../tools-engine.cjs');
const {previewFile,_internals:{loadPdf,renderPdfPage}}=require('../engine.cjs');
let dir,file,originalHash;
const hash=async f=>crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex');
async function run(tool,options={}){const [result]=await runTool({paths:[file],tool,options,outputDir:dir});assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.path.endsWith('.pdf'),true);return result;}
async function read(f){return PDFDocument.load(await fs.readFile(f),{updateMetadata:false});}
async function rendered(f,n=1){const pdf=await loadPdf(f);try{return await renderPdfPage(await pdf.getPage(n),1);}finally{await pdf.destroy();}}
async function pixels(f,n=1){return sharp((await rendered(f,n)).data).removeAlpha().raw().toBuffer({resolveWithObject:true});}
const at=(p,x,y)=>[...p.data.subarray((y*p.info.width+x)*p.info.channels,(y*p.info.width+x)*p.info.channels+3)];
async function text(f){const pdf=await loadPdf(f);try{let result='';for(let n=1;n<=pdf.numPages;n++)result+=(await(await pdf.getPage(n)).getTextContent()).items.map(x=>x.str||'').join(' ');return result;}finally{await pdf.destroy();}}
test.before(async()=>{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'sift-pdf-tools-'));file=path.join(dir,'Original_日本語.pdf');
 const doc=await PDFDocument.create({updateMetadata:false});doc.setTitle('Private title');doc.setAuthor('Private author');
 const first=doc.addPage([300,200]);first.drawRectangle({x:0,y:0,width:300,height:200,color:rgb(1,1,1)});first.drawRectangle({x:0,y:0,width:60,height:200,color:rgb(1,0,0)});first.drawText('SECRET 12345',{x:80,y:140,size:16});first.drawText('Visible text',{x:80,y:40,size:16});
 const second=doc.addPage([340,240]);second.drawRectangle({x:0,y:0,width:340,height:240,color:rgb(0,0,1)});second.drawText('Second page',{x:55,y:100,size:12,color:rgb(1,1,1)});second.setCropBox(20,30,260,160);second.setRotation(degrees(90));
 const xmp=doc.context.register(doc.context.stream('<x:xmpmeta>private-xmp</x:xmpmeta>',{Type:'Metadata',Subtype:'XML'}));doc.catalog.set(PDFName.of('Metadata'),xmp);
 const comment=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[90,140,100,150],Contents:PDFString.of('SECRET comment')}));first.node.set(PDFName.of('Annots'),doc.context.obj([comment]));
 await doc.attach(Buffer.from('SECRET attachment'),'secret.txt');
 await fs.writeFile(file,await doc.save({useObjectStreams:false}));originalHash=await hash(file);
});
test.after(async()=>{assert.equal(await hash(file),originalHash,'Original PDF must never change');await fs.rm(dir,{recursive:true,force:true,maxRetries:3});});
test('PDF inspector enables all seven tools and uses selected rotated/cropped page geometry',async()=>{
 const info=await inspectTools({path:file,page:2});assert.equal(info.error,undefined);assert.equal(info.tools.length,7);assert.equal(info.pages,2);assert.equal(info.width,160);assert.equal(info.height,260);assert.ok(info.metadata.some(m=>m.value==='Private title'));
 const url=await previewFile({path:file,page:2});const image=await sharp(Buffer.from(url.split(',')[1],'base64')).metadata();assert.equal(image.width,160);assert.equal(image.height,260);
 assert.match((await inspectTools({path:file,page:3})).error,/Page/);
});
test('compact preserves text, never grows, saves collision-safe copies',async()=>{
 const a=await run('compress'),b=await run('compress');assert.notEqual(a.path,b.path);assert.ok((await fs.stat(a.path)).size<=(await fs.stat(file)).size);assert.match(await text(a.path),/SECRET 12345/);assert.equal((await read(a.path)).getPageCount(),2);
});
test('metadata removes document properties and XMP while retaining visible text',async()=>{
 const result=await run('metadata');const doc=await read(result.path);assert.equal(doc.context.trailerInfo.Info,undefined);assert.equal(doc.getTitle(),undefined);assert.equal(doc.getAuthor(),undefined);assert.equal(doc.catalog.has(PDFName.of('Metadata')),false);assert.match(await text(result.path),/Visible text/);assert.equal(Buffer.from(await fs.readFile(result.path)).includes(Buffer.from('private-xmp')),false);
});
test('crop maps visual coordinates on a rotated page and leaves the other page intact',async()=>{
 const result=await run('crop',{page:2,left:10,top:20,width:80,height:120});const info=await inspectTools({path:result.path,page:2});assert.equal(info.width,80);assert.equal(info.height,120);assert.deepEqual((await pixels(result.path,1)).data,(await pixels(file,1)).data);assert.match(await text(result.path),/Visible text/);assert.match(result.warning,/does not permanently/);
 const source=await pixels(file,2),cropped=await pixels(result.path,2);assert.deepEqual(cropped.data,await sharp(source.data,{raw:source.info}).extract({left:10,top:20,width:80,height:120}).raw().toBuffer());
});
test('edit scales and rotates selected or all pages without losing selectable text',async()=>{
 const one=await run('edit',{page:2,rotate:90,scalePercent:50});const info=await inspectTools({path:one.path,page:2});assert.equal(info.width,130);assert.equal(info.height,80);assert.deepEqual((await pixels(one.path,1)).data,(await pixels(file,1)).data);assert.match(await text(one.path),/Second page/);
 const all=await run('edit',{rotate:90,allPages:true});assert.equal((await inspectTools(all.path)).width,200);assert.equal((await inspectTools({path:all.path,page:2})).width,260);
});
test('annotations render on rotated pages while retaining original text',async()=>{
 const result=await run('annotate',{page:2,text:'Hello 日本語 <&>',x:10,y:10,fontSize:20,color:'#ff0000'});const before=await pixels(file,2),after=await pixels(result.path,2);assert.notDeepEqual(before.data,after.data);let red=0;for(let y=10;y<40;y++)for(let x=10;x<150;x++){const p=at(after,x,y);if(p[0]>180&&p[1]<100&&p[2]<100)red++;}assert.ok(red>30,'Annotation must appear in visual top-left coordinates');assert.match(await text(result.path),/Second page/);assert.deepEqual((await pixels(file,1)).data,(await pixels(result.path,1)).data);
});
test('background frames the visual crop at the correct orientation and preserves text',async()=>{
 const result=await run('background',{page:2,padding:20,background:'#00ff00'});const after=await pixels(result.path,2);assert.equal(after.info.width,200);assert.equal(after.info.height,300);assert.deepEqual(at(after,5,5),[0,255,0]);const inner=await sharp(after.data,{raw:after.info}).extract({left:20,top:20,width:160,height:260}).raw().toBuffer();const expected=(await pixels(file,2)).data;const meanError=inner.reduce((sum,value,i)=>sum+Math.abs(value-expected[i]),0)/inner.length;assert.ok(meanError<0.5,`Frame pixel mean error: ${meanError}`);assert.match(await text(result.path),/Second page/);
});
test('redaction removes underlying text, metadata, annotations and attachments from a new PDF',async()=>{
 const result=await run('redact',{page:1,left:75,top:35,width:180,height:40,color:'#000000'});const doc=await read(result.path);assert.equal(doc.getPageCount(),2);assert.equal(await text(result.path),'');assert.equal(doc.getTitle(),undefined);assert.equal(doc.catalog.has(PDFName.of('Names')),false);assert.equal(doc.catalog.has(PDFName.of('Metadata')),false);for(const page of doc.getPages())assert.equal(page.node.Annots()?.size()||0,0);
 assert.deepEqual(at(await pixels(result.path),100,50),[0,0,0]);assert.deepEqual(at(await pixels(result.path),30,150),[255,0,0]);assert.match(result.warning,/permanently/);assert.match(result.warning,/All pages/);
 // Render output at its native raster resolution to avoid resampling differences.
 const outPdf=await loadPdf(result.path),sourcePdf=await loadPdf(file);try{assert.deepEqual((await renderPdfPage(await outPdf.getPage(2),2)).data,(await renderPdfPage(await sourcePdf.getPage(2),2)).data);}finally{await outPdf.destroy();await sourcePdf.destroy();}
});
test('flattened compression produces readable pages and explicitly reports loss of selectable text',async()=>{
 const result=await run('compress',{pdfMode:'raster',quality:50,maxSize:300});assert.equal((await read(result.path)).getPageCount(),2);assert.equal(await text(result.path),'');assert.match(result.warning,/Selectable text/);assert.equal((await pixels(result.path,2)).info.width,160);
});
test('processed previews use selected page; invalid input and cancellation publish no partial output',async()=>{
 const url=await previewTool({path:file,tool:'edit',options:{page:2,rotate:90}});const meta=await sharp(Buffer.from(url.split(',')[1],'base64')).metadata();assert.equal(meta.width,260);assert.equal(meta.height,160);
 const before=(await fs.readdir(dir)).sort();for(const [tool,options] of [['crop',{page:3}],['crop',{left:280,width:40,height:20}],['redact',{mode:'blur'}],['annotate',{text:''}],['edit',{rotate:45}],['compress',{pdfMode:'unknown'}]]){const [result]=await runTool({paths:[file],tool,options,outputDir:dir});assert.ok(result.error,tool);}
 const controller=new AbortController();await assert.rejects(runTool({paths:[file],tool:'redact',options:{left:0,top:0,width:30,height:30},outputDir:dir},e=>{if(e.page===1)controller.abort();},controller.signal),/cancel/i);assert.deepEqual((await fs.readdir(dir)).sort(),before);
});
test('background supports blank pages and all quarter-turn rotations with offset crops',async()=>{
 for(const angle of [0,90,180,270]){
  const doc=await PDFDocument.create();const page=doc.addPage([240,180]);page.drawRectangle({x:0,y:0,width:240,height:180,color:rgb(1,1,1)});page.drawRectangle({x:20,y:30,width:80,height:60,color:rgb(1,0,0)});page.setCropBox(20,30,160,120);page.setRotation(degrees(angle));doc.addPage([120,100]);const input=path.join(dir,`rotation-${angle}.pdf`);await fs.writeFile(input,await doc.save());
  const [result]=await runTool({paths:[input],tool:'background',options:{padding:10,background:'#00ff00',allPages:true},outputDir:dir});assert.equal(result.error,undefined,JSON.stringify(result));const source=await pixels(input),actual=await pixels(result.path);assert.deepEqual(await sharp(actual.data,{raw:actual.info}).extract({left:10,top:10,width:source.info.width,height:source.info.height}).raw().toBuffer(),source.data);assert.equal((await rendered(result.path,2)).width,140);
 }
});
