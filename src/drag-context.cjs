'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fileURLToPath } = require('node:url');

// Read the OS-owned drag pasteboard; never alter the user's clipboard.
function createMacDragContext(koffi) {
  const appkit = koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit');
  // NSDragPboard is an exported NSString constant, not its string value.
  // A literal "NSDragPboard" creates a different, empty named pasteboard.
  const dragBoardName = koffi.decode(appkit.symbol('NSPasteboardNameDrag', 'void *'), 'void *');
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const cls = objc.func('void * objc_getClass(const char *name)');
  const sel = objc.func('void * sel_registerName(const char *name)');
  const send0 = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
  const send1 = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']);
  const sendString = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'str']);
  const sendIndex = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'uint64']);
  const count = objc.func('objc_msgSend', 'uint64', ['void *', 'void *']);
  const text = objc.func('objc_msgSend', 'str', ['void *', 'void *']);
  const selectors = Object.fromEntries(['alloc','init','drain','stringWithUTF8String:','pasteboardWithName:',
    'changeCount','propertyListForType:','stringForType:','count','objectAtIndex:','UTF8String'].map(s=>[s,sel(s)]));
  const stringClass=cls('NSString'), boardClass=cls('NSPasteboard'), poolClass=cls('NSAutoreleasePool');
  const ns = value => sendString(stringClass,selectors['stringWithUTF8String:'],value);
  let baseline = null;
  function read(reset=false) {
    const pool=send0(send0(poolClass,selectors.alloc),selectors.init);
    try {
      const board=send1(boardClass,selectors['pasteboardWithName:'],dragBoardName);
      const generation=Number(count(board,selectors.changeCount));
      if(reset){baseline=generation;return [];}
      if(baseline===null||generation===baseline)return [];
      const values=send1(board,selectors['propertyListForType:'],ns('NSFilenamesPboardType'));
      const paths=[];
      if(values)for(let i=0,n=Math.min(100,Number(count(values,selectors.count)));i<n;i++){
        const value=text(sendIndex(values,selectors['objectAtIndex:'],i),selectors.UTF8String);
        if(value&&path.isAbsolute(value))paths.push(value);
      }
      if(!paths.length){
        const value=send1(board,selectors['stringForType:'],ns('public.file-url'));
        if(value){const url=text(value,selectors.UTF8String);if(url?.startsWith('file:'))paths.push(fileURLToPath(url));}
      }
      return paths;
    }finally{send0(pool,selectors.drain);}
  }
  const context=()=>read(false);context.reset=()=>read(true);context.reset();return context;
}

function createWindowsDragContext() {
  let child=null,pending=null,buffer='',sequence=0;
  const executable=path.join(__dirname,'native','SelectionProbe.exe');
  if(fs.existsSync(executable)){
    child=spawn(executable,[],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      buffer+=chunk;
      let end;
      while((end=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        let reply;try{reply=JSON.parse(line);}catch{continue;}
        const waiting=pending;
        if(waiting&&reply.id===waiting.id){pending=null;clearTimeout(waiting.timer);waiting.resolve(reply.files||[]);}
      }
    });
    const stopped=()=>{if(pending){clearTimeout(pending.timer);pending.resolve([]);pending=null;}child=null;};
    child.on('error',stopped);child.on('exit',stopped);
    child.stdin.on('error',stopped);
  }
  return {
    query(window,sourceClass){
      if(!child||pending||!/^\d+$/.test(String(window)))return Promise.resolve([]);
      return new Promise(resolve=>{
        const id=String(++sequence);
        pending={id,resolve,timer:setTimeout(()=>{pending=null;resolve([]);},300)};
        child.stdin.write(id+'|'+String(window)+'|'+(/^(progman|workerw)$/i.test(sourceClass)?'1':'0')+'\n');
      });
    },
    stop(){child?.stdin.end();child?.kill();child=null;},
  };
}
module.exports={createMacDragContext,createWindowsDragContext};
