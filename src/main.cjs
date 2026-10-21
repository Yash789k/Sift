'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, screen, globalShortcut } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const { inspectFiles, getCapabilities, convert, previewFile } = require('../engine.cjs');
const { startGlobalGesture, requestMacGestureAccess } = require('./global-gesture.cjs');
const { startCapture, stopCapture } = require('./capture.cjs');
const { createWindowsDragContext } = require('./drag-context.cjs');
app.setName('Sift');
const isDemo = process.argv.includes('--demo');
if (isDemo) app.setPath('userData', path.join(__dirname, '..', '.demo-data'));
let win, tray, stopGesture, currentJob, releaseTimer, diagnosticTimer;
let quitting=false, quickMode=false, nativeDialogOpen=false, ingestionInProgress=false;
let retainedQuick=false, wheelKind='formats', editorOpen=false;
let selectionProbe, dragContext, contextEpoch=0;
let state = { outputDir:null, gestureEnabled:true, history:[], radialVersion:2 };
const stateFile=path.join(app.getPath('userData'),'settings.json');
const gestureLogFile=path.join(app.getPath('userData'),'gesture-diagnostics.json');
const gestureEvents=[];
try { state={...state,...JSON.parse(fs.readFileSync(stateFile,'utf8'))}; } catch {}
// Migrate the dashboard's automatic Downloads destination to source-adjacent.
if(state.radialVersion!==3){state.outputDir=null;state.radialVersion=3;}
if(typeof state.outputDir!=='string'||!path.isAbsolute(state.outputDir))state.outputDir=null;
state.gestureEnabled=state.gestureEnabled!==false;
state.history=Array.isArray(state.history)?state.history.filter(i=>i&&typeof i.path==='string'&&typeof i.name==='string'&&Number.isFinite(i.size)).slice(0,30):[];
function saveState(){fs.mkdirSync(path.dirname(stateFile),{recursive:true});fs.writeFileSync(stateFile,JSON.stringify(state,null,2));}
function recordGesture(event){
  gestureEvents.push({time:new Date().toISOString(),...event});
  if(gestureEvents.length>40)gestureEvents.shift();
  clearTimeout(diagnosticTimer);
  diagnosticTimer=setTimeout(()=>{
    try{fs.mkdirSync(path.dirname(gestureLogFile),{recursive:true});fs.writeFileSync(gestureLogFile,JSON.stringify({version:3,events:gestureEvents},null,2));}
    catch(error){console.error('Unable to save gesture diagnostics:',error.message);}
  },100);diagnosticTimer.unref?.();
}
function send(type,value){if(win&&!win.isDestroyed())win.webContents.send(type,value);}
async function warmDragContext(input){
  const epoch=++contextEpoch;dragContext=undefined;
  const started=performance.now();
  try{
    const paths=(input.files||await selectionProbe?.query(input.sourceWindow,input.sourceClass)||[])
      .filter(p=>typeof p==='string'&&path.isAbsolute(p)).slice(0,100);
    if(!paths.length||epoch!==contextEpoch)return;
    const rows=await Promise.all(paths.map(async p=>{
      const extension=path.extname(p).slice(1).toLowerCase();
      const kind=extension==='pdf'?'pdf':/^(mp3|wav|m4a|flac|ogg|aac|aiff|wma)$/.test(extension)?'audio':
        /^(mp4|mov|mkv|webm|avi|m4v|wmv)$/.test(extension)?'video':'image';
      return{kind,ext:extension,size:(await fs.promises.stat(p)).size};
    }));
    if(epoch!==contextEpoch)return;
    dragContext={kind:rows.every(r=>r.kind===rows[0].kind)?rows[0].kind:'mixed',ext:rows.every(r=>r.ext===rows[0].ext)?rows[0].ext:undefined,count:rows.length,size:rows.reduce((n,r)=>n+r.size,0)};
    if(quickMode&&!editorOpen)send('mode',{mode:'wheel',kind:wheelKind,context:dragContext,fresh:false});
    recordGesture({event:'drag-context',kind:dragContext.kind,count:dragContext.count,elapsedMs:Math.round(performance.now()-started)});
  }catch{ /* File context is advisory; real drops are inspected separately. */ }
}
function boundsAt(point,width,height){
  const cursor=point||screen.getCursorScreenPoint();
  const area=screen.getDisplayNearestPoint(cursor).workArea;
  return{width,height,x:Math.round(Math.max(area.x,Math.min(cursor.x-width/2,area.x+area.width-width))),
    y:Math.round(Math.max(area.y,Math.min(cursor.y-height/2,area.y+area.height-height)))};
}
function showWheel({point,kind='formats',manual=false,fresh=true,files}={}){
  if(!win||win.isDestroyed())return false;
  if(currentJob||nativeDialogOpen||(ingestionInProgress&&fresh)){if(manual)win.show();return false;}
  clearTimeout(releaseTimer);quickMode=!manual;retainedQuick=false;editorOpen=false;wheelKind=kind;
  const bounds=boundsAt(point,400,400);
  win.setMinimumSize(1,1);win.setBounds(bounds);win.setAlwaysOnTop(true,'floating');
  send('mode',{mode:'wheel',kind,fresh,...(!manual&&dragContext?{context:dragContext}:{}),...(files?{files}:{})});
  if(manual)win.show();else win.showInactive();
  // Windows restores remembered bounds when showing a minimized window.
  win.setBounds(bounds);
  recordGesture({event:'wheel-shown',kind,visible:win.isVisible()});return true;
}
function showEditor({tool,width=390,height=600}={}){
  clearTimeout(releaseTimer);quickMode=false;retainedQuick=true;editorOpen=true;
  const old=win.getBounds();
  const bounds=boundsAt({x:old.x+old.width/2,y:old.y+old.height/2},
    Math.max(360,Math.min(560,Number(width)||390)),Math.max(420,Math.min(780,Number(height)||600)));
  win.setBounds(bounds);win.show();win.setBounds(bounds);recordGesture({event:'editor-shown',tool});
}
function hideWindow(){clearTimeout(releaseTimer);quickMode=false;editorOpen=false;retainedQuick=false;win?.hide();}
function setupGesture(){
  stopGesture?.();stopGesture=undefined;
  if(!state.gestureEnabled){recordGesture({event:'disabled'});return;}
  stopGesture=startGlobalGesture({
    onDragStart:input=>{void warmDragContext(input);},
    onTrigger:point=>{
      if(currentJob||nativeDialogOpen||ingestionInProgress||retainedQuick||editorOpen||!win||win.isDestroyed())return false;
      const cursor=process.platform==='win32'?screen.screenToDipPoint(point):point;
      return showWheel({point:cursor,kind:point.kind||'formats'});
    },
    onModeChange:kind=>{
      if(!quickMode||editorOpen||currentJob)return;
      wheelKind=kind;send('mode',{mode:'wheel',kind,fresh:false});
    },
    onRelease:()=>{
      contextEpoch++;
      releaseTimer=setTimeout(()=>{if(quickMode&&!currentJob&&!retainedQuick&&!ingestionInProgress)hideWindow();},700);
    },
    onError:error=>{
      recordGesture({event:'error',message:error.message});
      send('gesture-status',{available:false,message:'Drag shortcut unavailable. Click the tray icon to open the wheel.'});
    },onDiagnostic:recordGesture,
  });
  recordGesture({event:'reader-started',available:stopGesture.available,platform:process.platform});
  send('gesture-status',{available:stopGesture.available});
}
function rebuildTray(){
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Open format wheel',click:()=>showWheel({manual:true})},
    {label:'Open tool wheel',click:()=>showWheel({manual:true,kind:'tools'})},
    {type:'separator'},
    {label:'Drag shortcuts',type:'checkbox',checked:state.gestureEnabled,click:item=>{
      state.gestureEnabled=item.checked;saveState();setupGesture();send('state',state);
    }},
    {label:'Save beside originals',type:'checkbox',checked:!state.outputDir,click:()=>{
      state.outputDir=null;saveState();rebuildTray();send('state',state);
    }},
    ...(process.platform==='darwin'?[{label:'Enable drag shortcut access…',click:()=>{
      // The user, not Sift, grants OS-owned consent.
      requestMacGestureAccess();
      setupGesture();
    }}]:[]),
    {type:'separator'},{label:'Quit Sift',click:()=>{quitting=true;app.quit();}},
  ]));
}
function handleLaunchArguments(args,initial=false){
  if(args.includes('--stop-capture')){stopCapture();return;}
  const index=args.indexOf('--capture-dir');
  if(index>=0){
    const directory=args[index+1],secondsIndex=args.indexOf('--capture-seconds');
    if(typeof directory==='string'&&path.isAbsolute(directory)){
      if(!win.isVisible())showWheel({manual:true});
      startCapture(win,directory,secondsIndex>=0?Number(args[secondsIndex+1]):120).catch(console.error);
    }return;
  }
  if(!initial||args.includes('--show-wheel')||isDemo||!state.radialOnboarded){
    showWheel({manual:true});state.radialOnboarded=true;saveState();
  }
}
function createWindow(){
  Menu.setApplicationMenu(null);
  if(process.platform==='win32')selectionProbe=createWindowsDragContext();
  win=new BrowserWindow({
    width:400,height:400,minWidth:1,minHeight:1,title:'Sift',backgroundColor:'#00000000',icon:path.join(__dirname,'icon.png'),
    frame:false,transparent:true,show:false,hasShadow:false,resizable:false,skipTaskbar:true,alwaysOnTop:true,fullscreenable:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false},
  });
  win.loadFile(path.join(__dirname,'index.html')).then(()=>{setupGesture();handleLaunchArguments(process.argv,true);}).catch(console.error);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.on('close',event=>{if(!quitting){event.preventDefault();hideWindow();}});
  const icon=nativeImage.createFromPath(path.join(__dirname,'tray.png'));
  if(process.platform==='darwin')icon.setTemplateImage(true);
  tray=new Tray(icon.resize({width:20,height:20}));tray.setToolTip('Sift · Drag, Shift, drop');rebuildTray();
  tray.on('click',()=>showWheel({manual:true}));
  globalShortcut.register('CommandOrControl+Alt+Space',()=>showWheel({manual:true}));
  if(process.platform==='darwin')app.dock?.hide();
}
function validateRequest(request){
  if(!request||!Array.isArray(request.paths)||request.paths.length<1||request.paths.length>100||request.paths.some(p=>typeof p!=='string'||!path.isAbsolute(p)))throw new Error('Choose 1–100 local files.');
}
async function runJob(request,runner,label){
  validateRequest(request);if(currentJob)throw new Error('A file operation is already running.');
  clearTimeout(releaseTimer);retainedQuick=true;
  const controller=new AbortController();currentJob=controller;
  try{
    const started=performance.now();
    const results=await runner({...request,outputDir:state.outputDir},progress=>send('progress',progress),controller.signal);
    const successes=results.filter(item=>!item.error);
    if(successes.length){state.history=[...successes.map(item=>({...item,time:Date.now(),format:label})),...state.history].slice(0,30);saveState();}
    recordGesture({event:'operation-finished',operation:label,count:results.length,elapsedMs:Math.round(performance.now()-started)});
    send('state',state);return results;
  }finally{currentJob=null;retainedQuick=false;}
}
ipcMain.handle('state',()=>({...state,platform:process.platform,capabilities:getCapabilities(),gestureAvailable:stopGesture?.available??false}));
ipcMain.handle('ingestion-begin',()=>{ingestionInProgress=true;clearTimeout(releaseTimer);});
ipcMain.handle('ingestion-end',()=>{ingestionInProgress=false;retainedQuick=false;});
ipcMain.handle('choose-files',async()=>{
  nativeDialogOpen=true;clearTimeout(releaseTimer);
  try{const result=await dialog.showOpenDialog(win,{title:'Choose files',properties:['openFile','multiSelections']});return result.canceled?[]:inspectFiles(result.filePaths);}
  finally{nativeDialogOpen=false;}
});
ipcMain.handle('sample',()=>inspectFiles([path.join(__dirname,'..','samples','Aurora.png')]));
ipcMain.handle('preview',(_event,filePath)=>previewFile(filePath));
ipcMain.handle('inspect',(_event,paths)=>{
  clearTimeout(releaseTimer);retainedQuick=true;
  if(!Array.isArray(paths)||paths.length>100||paths.some(p=>typeof p!=='string'||!path.isAbsolute(p)))throw new Error('Choose up to100 local files.');
  return inspectFiles(paths);
});
ipcMain.handle('inspect-tools',(_event,paths)=>require('../tools-engine.cjs').inspectTools(paths));
ipcMain.handle('tool-preview',(_event,request)=>require('../tools-engine.cjs').previewTool(request));
ipcMain.handle('run-tool',(_event,request)=>{
  if(typeof request?.tool!=='string')throw new Error('Choose a tool.');
  return runJob(request,require('../tools-engine.cjs').runTool,request.tool);
});
ipcMain.handle('convert',(_event,request)=>{
  if(typeof request?.format!=='string'||request.format.length>12)throw new Error('Choose an output format.');
  return runJob(request,convert,request.format);
});
ipcMain.handle('choose-output',async()=>{
  nativeDialogOpen=true;
  try{const result=await dialog.showOpenDialog(win,{title:'Save converted files here',defaultPath:state.outputDir||app.getPath('downloads'),properties:['openDirectory','createDirectory']});
    if(!result.canceled){state.outputDir=result.filePaths[0];saveState();rebuildTray();}return state.outputDir;
  }finally{nativeDialogOpen=false;}
});
ipcMain.handle('cancel',()=>{currentJob?.abort();return true;});
ipcMain.handle('show-result',(_event,filePath)=>{
  if(!state.history.some(item=>item.path===filePath))return false;
  if(fs.existsSync(filePath)){shell.showItemInFolder(filePath);return true;}return false;
});
ipcMain.handle('open-output',()=>shell.openPath(state.outputDir||(state.history[0]?path.dirname(state.history[0].path):app.getPath('downloads'))));
ipcMain.handle('gesture',(_event,enabled)=>{state.gestureEnabled=!!enabled;saveState();setupGesture();rebuildTray();return state.gestureEnabled;});
ipcMain.handle('window',(_event,value)=>{
  const request=typeof value==='string'?{action:value}:value||{};
  if(request.action==='hide'||request.action==='minimize')hideWindow();
  if(request.action==='wheel'||request.action==='expand')showWheel({manual:true,kind:request.kind||wheelKind,fresh:false});
  if(request.action==='editor')showEditor(request);
  if(request.action==='quit'){quitting=true;app.quit();}
});
if(!app.requestSingleInstanceLock({argv:process.argv}))app.quit();
else{
  app.on('second-instance',(_event,args,_directory,data)=>handleLaunchArguments(Array.isArray(data?.argv)?data.argv:args));
  app.whenReady().then(createWindow);app.on('activate',()=>{if(win)showWheel({manual:true});});
}
app.on('before-quit',()=>{quitting=true;stopGesture?.();selectionProbe?.stop();stopCapture();currentJob?.abort();globalShortcut.unregisterAll();});
app.on('window-all-closed',()=>{});
