const test=require('node:test'),assert=require('node:assert/strict');
const {imageTargets,adjustSelection}=require('../src/wheel-geometry.js');
test('image wheel excludes its source while retaining JPEG and eight targets',()=>{
 for(const source of ['png','jpg','webp','heic','gif','avif','bmp']){const targets=imageTargets(source);assert.equal(targets.outer.length,8);assert.ok(!targets.outer.some(([id])=>id===(source==='jpg'?'jpeg':source)));assert.equal(targets.center,'tiff');}
 assert.ok(imageTargets('png').outer.some(([id])=>id==='jpeg'));
 assert.deepEqual(imageTargets('jpg').outer.map(([id])=>id),['png','webp','heic','gif','avif','bmp','pdf','docx']);
 assert.equal(imageTargets('tiff').center,'docx');
});
test('moving crop selection clamps to image bounds without resizing',()=>{
 assert.deepEqual(adjustSelection({left:40,top:50,width:100,height:80},'move',-500,500,{width:320,height:240}),{left:0,top:160,width:100,height:80});
});
test('vertical aspect-ratio handle changes size and preserves center on the other axis',()=>{
 assert.deepEqual(adjustSelection({left:300,top:0,width:1000,height:1000},'s',0,-200,{width:1600,height:1000},1),{left:400,top:0,width:800,height:800});
});
test('corner aspect crop respects opposite anchor and image limits',()=>{
 assert.deepEqual(adjustSelection({left:300,top:0,width:1000,height:1000},'nw',100,100,{width:1600,height:1000},1),{left:400,top:100,width:900,height:900});
 assert.deepEqual(adjustSelection({left:300,top:0,width:1000,height:1000},'se',500,500,{width:1600,height:1000},1),{left:300,top:0,width:1000,height:1000});
});
test('free crop handles never invert a selection',()=>{
 assert.deepEqual(adjustSelection({left:50,top:50,width:100,height:80},'nw',500,500,{width:320,height:240}),{left:149,top:129,width:1,height:1});
});
