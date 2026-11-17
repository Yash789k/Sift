'use strict';
// Real main, preload, worker and renderer. Only OS chooser/reveal use fixtures.
const {app,BrowserWindow,Tray,dialog,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(process.env.SIFT_APP_ROOT||path.join(__dirname,'..'));
const {PDFDocument,rgb,degrees}=require(path.join(root,'node_modules/pdf-lib'));
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sift-pdf-desktop-')),profile=path.join(folder,'profile'),out=path.join(folder,'out');fs.mkdirSync(profile);fs.mkdirSync(out);app.setPath('userData',profile);
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({outputDir:out,gestureEnabled:false,soundEnabled:false,history:[],radialVersion:3}));
let menu,chosen;const nativeMenu=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(value){menu=value;return nativeMenu.call(this,value);};dialog.showOpenDialog=async()=>({canceled:false,filePaths:[chosen]});shell.showItemInFolder=()=>{};
const errors=[],checks=[];app.on('browser-window-created',(_event,window)=>{window.webContents.on('render-process-gone',(_e,d)=>errors.push(d.reason));});
const pause=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await pause(30);}throw new Error(`Timeout: ${label}`);}
const wheel=()=>BrowserWindow.getAllWindows().find(w=>/index\.html$/.test(w.webContents.getURL()));
const js=code=>wheel().webContents.executeJavaScript(`(async()=>{try{return await (${code})}catch(e){return {qaError:e.stack}}})()`).then(r=>{if(r?.qaError)throw new Error(r.qaError);return r;});
const click=label=>menu.items.find(x=>x.label?.startsWith(label)).click();
require(path.join(root,'src/main.cjs'));
app.whenReady().then(async()=>{try{
 const doc=await PDFDocument.create();doc.setTitle('Sift PDF test');const first=doc.addPage([420,300]);first.drawText('PDF editing check',{x:35,y:220,size:25});first.drawText('This original stays unchanged.',{x:35,y:160,size:16});const second=doc.addPage([300,460]);second.drawRectangle({x:0,y:0,width:300,height:460,color:rgb(.9,.95,1)});second.drawText('Page two',{x:30,y:340,size:22});second.setRotation(degrees(90));chosen=path.join(folder,'PDF editing check.pdf');fs.writeFileSync(chosen,await doc.save());const hash=crypto.createHash('sha256').update(fs.readFileSync(chosen)).digest('hex');
 await until(()=>menu,'tray');
 for(const tool of ['crop','edit','annotate','background','compress','metadata','redact']){
  console.log('Testing PDF tool',tool);await click('Convert files');await until(()=>wheel()&&!wheel().webContents.isLoadingMainFrame(),'wheel');await until(()=>wheel().isVisible()&&js('mode==="wheel"&&files.length===1&&!locked()'),'file loaded');
  await js('(wheelKind="tools",renderWheel(),undefined)');assert.equal(await js('document.querySelectorAll(".wedge[aria-disabled=false]").length'),7);
  await js(`document.querySelector('.wedge[data-id="${tool}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await until(()=>js('editorReady&&!editorLoading'),'editor ready');assert.equal(await js('document.querySelector("#editor-error").textContent'),'');
  if(tool!=='metadata'){
   await js('(()=>{const select=document.querySelector("#pdf-page");select.value="2";select.dispatchEvent(new Event("change"));})()');
   assert.equal(await js('document.querySelector("#apply-editor").disabled'),true,'Apply disabled while page loads');
   await until(()=>js('editorReady&&!editorLoading&&editOptions.page===2'),'page 2');assert.equal(await js('files[0].width'),460);
  }
  if(tool==='edit')await js('(()=>{const b=[...document.querySelectorAll(".segmented button")].find(x=>x.textContent==="90°");b.click();})()');
  if(tool==='annotate')await js('(()=>{const input=document.querySelector("textarea");input.value="Reviewed in Sift";input.dispatchEvent(new Event("input"));})()');
  if(tool==='redact'){assert.equal(await js('[...document.querySelectorAll("#editor-controls button")].some(x=>x.textContent==="Blur")'),false);assert.match(await js('document.querySelector("#editor-controls").textContent'),/All pages become images/);}
  if(tool==='compress')assert.equal(await js('editOptions.pdfMode'),'compact');
  if(['edit','annotate','background','compress'].includes(tool))await until(()=>js('!document.querySelector("#processed-preview").classList.contains("hidden")||Boolean(document.querySelector("#editor-error").textContent)'),'processed preview');
  assert.equal(await js('document.querySelector("#editor-error").textContent'),'');
  if(tool==='annotate'){await pause(200);fs.writeFileSync(path.join(folder,'pdf_annotation_editor.png'),(await wheel().webContents.capturePage()).toPNG());}
  await js('applyEditor()');await until(()=>!wheel().isVisible(),'editor closes after save');
  const outputs=fs.readdirSync(out).filter(f=>f.endsWith(`-${tool==='metadata'?'metadata-removed':tool}.pdf`));assert.equal(outputs.length,1,tool);const saved=await PDFDocument.load(fs.readFileSync(path.join(out,outputs[0])));assert.equal(saved.getPageCount(),2);checks.push(`${tool}: enabled PDF wheel, real editor and worker, valid two-page PDF saved`);
 }
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(chosen)).digest('hex'),hash);
 chosen=path.join(root,'samples/Aurora.png');await click('Convert files');await until(()=>js('files[0]?.kind==="image"&&!locked()'),'image');await js('openEditor("redact")');assert.equal(await js('document.querySelector("#pdf-page")'),null);assert.equal(await js('[...document.querySelectorAll(".segmented button")].some(x=>x.textContent==="Blur")'),true);checks.push('Image redaction retains its existing controls; original PDF hash unchanged.');
 assert.deepEqual(errors,[]);const result={pass:true,checks,folder};fs.writeFileSync(process.env.SIFT_PDF_QA_RESULT||path.join(folder,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await click('Quit');
}catch(error){console.error(error.stack);console.error('Evidence folder:',folder);app.exit(1);}});
