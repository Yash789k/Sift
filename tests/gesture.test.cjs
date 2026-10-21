'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGestureTracker, createGesturePoller, isFileSourceClass } = require('../src/global-gesture.cjs');

test('desktop activation accepts Explorer and desktop, not text drags or dialogs', () => {
  for (const name of ['CabinetWClass', 'ExploreWClass', 'Progman', 'WorkerW']) assert.equal(isFileSourceClass(name), true);
  for (const name of ['Chrome_WidgetWin_1', '#32770', '', null]) assert.equal(isFileSourceClass(name), false);
});

test('Shift clicks and ordinary drags do not open the palette', () => {
  const events = [];
  const tracker = createGestureTracker({ onTrigger: p => events.push(p) });
  tracker.sample({ down: true, shift: true, x: 40, y: 40 });
  tracker.sample({ down: true, shift: true, x: 42, y: 41 });
  tracker.sample({ down: false });
  tracker.sample({ down: true, shift: false, x: 40, y: 40 });
  tracker.sample({ down: true, shift: false, x: 90, y: 90 });
  tracker.sample({ down: false });
  assert.equal(events.length, 0);
});

test('Shift tapped during drag opens once and release closes once', () => {
  const events = [];
  const tracker = createGestureTracker({
    onTrigger: p => events.push(['open', p]),
    onRelease: () => events.push(['release']),
  });
  tracker.sample({ down: true, shift: false, x: 20, y: 30 });
  tracker.sample({ down: true, shift: false, x: 100, y: 90 });
  tracker.sample({ down: true, shift: true, x: 105, y: 92 });
  tracker.sample({ down: true, shift: false, x: 110, y: 95 });
  tracker.sample({ down: true, shift: true, x: 110, y: 95 });
  tracker.sample({ down: false });
  tracker.sample({ down: false });
  assert.deepEqual(events, [['open', { x: 105, y: 92 }], ['release']]);
});

test('new drag re-arms, negative monitor coordinates are valid, reset cancels', () => {
  let count = 0;
  const tracker = createGestureTracker({ onTrigger: () => count++ });
  for (let i = 0; i < 2; i++) {
    tracker.sample({ down: true, shift: true, x: -900, y: -30 });
    tracker.sample({ down: true, shift: true, x: -880, y: -20 });
    tracker.sample({ down: false });
  }
  assert.equal(count, 2);
  tracker.sample({ down: true, shift: true, x: 0, y: 0 });
  tracker.reset();
  tracker.sample({ down: true, shift: true, x: 100, y: 100 });
  assert.equal(count, 2);
});

test('temporarily rejected triggers retry without requiring a second mouse-down', () => {
  let attempts = 0, releases = 0;
  const tracker = createGestureTracker({ onTrigger: () => ++attempts > 1, onRelease: () => releases++ });
  tracker.sample({ down: true, shift: true, x: 0, y: 0 });
  tracker.sample({ down: true, shift: true, x: 20, y: 20 });
  tracker.sample({ down: true, shift: true, x: 25, y: 25 });
  tracker.sample({ down: true, shift: true, x: 30, y: 30 });
  tracker.sample({ down: false });
  assert.equal(attempts, 2);
  assert.equal(releases, 1);
});

function replay(inputs) {
  const events = [], diagnostics = [];
  let input, time = 0;
  const poller = createGesturePoller({ read: () => input, now: () => time,
    onTrigger: p => events.push(['open', p]), onRelease: () => events.push(['release']),
    onDiagnostic: event => diagnostics.push(event) });
  for (input of inputs) { time += input.elapsed || 25; poller.poll(); }
  return { events, diagnostics };
}

test('Explorer pointer source activates despite stale or null foreground focus', () => {
  for (const foregroundClass of ['Chrome_WidgetWin_1', '', null]) {
    const { events } = replay([
      { down: true, shift: false, x: 10, y: 10, sourceClass: 'CabinetWClass', foregroundClass },
      { down: true, shift: true, x: 30, y: 30, sourceClass: 'SysDragImage', foregroundClass },
      { down: false },
    ]);
    assert.deepEqual(events, [['open', { x: 30, y: 30 }], ['release']]);
  }
});

test('shell drag image can use a recent nearby Explorer pointer sample', () => {
  const { events, diagnostics } = replay([
    { down: false, x: 10, y: 10, sourceClass: 'CabinetWClass' },
    { down: true, shift: false, x: 20, y: 20, sourceClass: 'SysDragImage' },
    { down: true, shift: true, x: 35, y: 35, sourceClass: 'Chrome_WidgetWin_1' },
    { down: false },
  ]);
  assert.equal(events.length, 2);
  assert.equal(diagnostics[0].source, 'recent-pointer');
});

test('browser and dialog drags stay ineligible even when they cross Explorer', () => {
  for (const sourceClass of ['Chrome_WidgetWin_1', '#32770']) {
    const { events } = replay([
      { down: false, x: 10, y: 10, sourceClass: 'CabinetWClass' },
      { down: true, shift: false, x: 10, y: 10, sourceClass },
      { down: true, shift: true, x: 35, y: 35, sourceClass: 'CabinetWClass' },
      { down: false },
    ]);
    assert.deepEqual(events, []);
  }
});

test('fast shell drag can stop before Shift without losing its first movement', () => {
  const { events } = replay([
    { down: false, x: 10, y: 10, sourceClass: 'CabinetWClass' },
    { down: true, shift: false, x: 50, y: 50, sourceClass: 'SysDragImage' },
    { down: true, shift: true, x: 50, y: 50, sourceClass: 'SysDragImage' },
    { down: false },
  ]);
  assert.deepEqual(events, [['open', { x: 50, y: 50 }], ['release']]);
});

test('stale or distant hover samples cannot authorize an unknown source', () => {
  for (const next of [{ elapsed: 200, x: 10, y: 10 }, { x: 400, y: 400 }]) {
    const { events } = replay([
      { down: false, x: 10, y: 10, sourceClass: 'CabinetWClass' },
      { down: true, shift: false, sourceClass: '', ...next },
      { down: true, shift: true, x: 500, y: 500, sourceClass: 'CabinetWClass' },
      { down: false },
    ]);
    assert.deepEqual(events, []);
  }
});

test('tool modifier opens tools directly and changes wheel without reopening', () => {
  const events=[];
  const tracker=createGestureTracker({onTrigger:p=>events.push(['open',p]),onModeChange:k=>events.push(['mode',k]),onRelease:()=>events.push(['release'])});
  tracker.sample({down:true,tools:true,x:0,y:0});
  tracker.sample({down:true,tools:true,x:20,y:20});
  tracker.sample({down:true,tools:true,shift:true,x:20,y:20});
  tracker.sample({down:true,shift:true,x:20,y:20});
  tracker.sample({down:true,tools:true,x:20,y:20});
  tracker.sample({down:false});
  assert.deepEqual(events,[['open',{x:20,y:20,kind:'tools'}],['mode','formats'],['mode','tools'],['release']]);
});

test('late macOS file payload reuses movement and opens without another drag', () => {
  let input;const opened=[],contexts=[];
  const poller=createGesturePoller({read:()=>input,onTrigger:p=>opened.push(p),onDragStart:p=>contexts.push(p.files)});
  for(input of [
    {down:true,x:0,y:0,fileDrag:false},
    {down:true,x:50,y:50,shift:true,fileDrag:false},
    {down:true,x:50,y:50,shift:true,fileDrag:true,files:['/tmp/source.jpg']},
    {down:true,x:50,y:50,shift:true,fileDrag:true,files:['/tmp/source.jpg']},
    {down:false},
  ])poller.poll();
  assert.deepEqual(opened,[{x:50,y:50}]);assert.deepEqual(contexts,[['/tmp/source.jpg']]);
});

test('recent shell source retains original selection window for context lookup', () => {
  let input;const contexts=[];
  const poller=createGesturePoller({read:()=>input,now:()=>0,onDragStart:p=>contexts.push([p.sourceWindow,p.sourceClass])});
  for(input of [
    {down:false,x:10,y:10,sourceClass:'CabinetWClass',sourceWindow:'123'},
    {down:true,x:25,y:25,sourceClass:'SysDragImage',sourceWindow:'456'},
  ])poller.poll();
  assert.deepEqual(contexts,[['123','CabinetWClass']]);
});

test('Windows native reader returns numeric handle and survives repeated polling', {skip:process.platform!=='win32'}, () => {
  const {createWindowsReader}=require('../src/global-gesture.cjs');
  const read=createWindowsReader(require('koffi'));
  for(let i=0;i<20;i++){
    const input=read();assert.equal(typeof input.down,'boolean');
    if(input.sourceWindow!==null)assert.match(input.sourceWindow,/^\d+$/);
    assert.equal(typeof input.tools,'boolean');assert.equal(typeof input.windowMove,'boolean');assert.ok(Number.isFinite(input.x));
  }
});

test('Explorer window move detected after mouse-down cannot activate or re-arm until release', () => {
  const { events, diagnostics } = replay([
    { down: true, shift: false, x: 10, y: 10, sourceClass: 'CabinetWClass', windowMove: false },
    { down: true, shift: true, x: 40, y: 40, sourceClass: 'CabinetWClass', windowMove: true },
    { down: true, shift: true, x: 60, y: 60, sourceClass: 'CabinetWClass', windowMove: false },
    { down: false },
    { down: true, shift: false, x: 10, y: 10, sourceClass: 'CabinetWClass', windowMove: false },
    { down: true, shift: true, x: 40, y: 40, sourceClass: 'SysDragImage', windowMove: false },
    { down: false },
  ]);
  assert.deepEqual(events, [['open', { x: 40, y: 40 }], ['release']]);
  assert.equal(diagnostics.filter(row => row.event === 'window-move-rejected').length, 1);
});

test('late window move detection releases an already-open wheel once', () => {
  const { events } = replay([
    { down: true, shift: true, x: 10, y: 10, sourceClass: 'CabinetWClass' },
    { down: true, shift: true, x: 40, y: 40, sourceClass: 'CabinetWClass' },
    { down: true, shift: true, x: 50, y: 50, sourceClass: 'CabinetWClass', windowMove: true },
    { down: true, shift: true, x: 60, y: 60, sourceClass: 'CabinetWClass', windowMove: true },
    { down: false },
  ]);
  assert.deepEqual(events, [['open', { x: 40, y: 40 }], ['release']]);
});

test('Windows live listener remains available after native polls and can restart', {skip:process.platform!=='win32'}, async () => {
  const {startGlobalGesture}=require('../src/global-gesture.cjs');const errors=[];
  for(let i=0;i<2;i++){
    const stop=startGlobalGesture({onTrigger:()=>false,onError:e=>errors.push(e.message)});
    try{await new Promise(resolve=>setTimeout(resolve,75));assert.equal(stop.available,true);}
    finally{stop();}
    assert.equal(stop.available,false);
  }
  assert.deepEqual(errors,[]);
});
