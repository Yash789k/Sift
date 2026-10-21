'use strict';

/**
 * A deliberately small native gesture reader. It observes the primary mouse
 * button, wheel modifiers and the pointer. It neither intercepts input nor records
 * typed keys. The native drag/drop payload still comes from Electron's drop.
 */
function createGestureTracker({ onTrigger, onRelease, onModeChange, threshold = 6 }) {
  let origin = null;
  let triggered = false;
  let dragged = false;
  let activeKind = null;
  return {
    sample({ down, shift, tools, x, y, eligible = true }) {
      if (!down) {
        const released = triggered;
        origin = null;
        triggered = false;
        dragged = false;
        activeKind = null;
        if (released) onRelease?.();
        return;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (!origin) origin = { x, y };
      if (Math.hypot(x - origin.x, y - origin.y) >= threshold) dragged = true;
      const kind = tools ? 'tools' : shift ? 'formats' : null;
      if (eligible && dragged && kind && !triggered) {
        // A temporarily busy window must not consume the entire drag.
        triggered = onTrigger?.({ x, y, ...(kind === 'tools' ? { kind } : {}) }) !== false;
        if (triggered) activeKind = kind;
      } else if (triggered && kind && kind !== activeKind) {
        activeKind = kind;
        onModeChange?.(kind);
      }
    },
    reset() {
      origin = null;
      triggered = false;
      dragged = false;
      activeKind = null;
    },
  };
}

function isFileSourceClass(value) {
  return ['cabinetwclass', 'explorewclass', 'progman', 'workerw'].includes(String(value).toLowerCase());
}

// Kept separate from FFI so activation races can be replayed in tests. Resolve
// the source under the pointer, not the foreground window (which may still be
// the previously active app, or NULL, during mouse-down activation).
function createGesturePoller({ read, onTrigger, onRelease, onModeChange, onDragStart, onDiagnostic = () => {}, now = Date.now }) {
  let previous = null, drag = null;
  const tracker = createGestureTracker({
    onTrigger: point => {
      const accepted = onTrigger?.(point) !== false;
      if (drag && drag.lastAccepted !== accepted) {
        onDiagnostic({ event: accepted ? 'trigger-accepted' : 'trigger-deferred' });
        drag.lastAccepted = accepted;
      }
      return accepted;
    },
    onRelease,
    onModeChange,
  });
  return {
    poll() {
      const input = read();
      if (!input.down) {
        tracker.sample({ down: false });
        if (drag) onDiagnostic({ event: 'drag-ended', eligible: drag.eligible, shiftSeen: drag.shiftSeen });
        drag = null;
        previous = { ...input, time: now() };
        return;
      }
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return;
      if (!drag) {
        // A shell drag image can cover the original window by our first poll.
        // A nearby, recent pre-click sample retains the real source in that case.
        const transient = !input.sourceClass || /^sysdragimage$/i.test(input.sourceClass);
        const recentSource = transient && previous && now() - previous.time <= 160 &&
          Math.hypot(input.x - previous.x, input.y - previous.y) <= 80 &&
          isFileSourceClass(previous.sourceClass);
        drag = {
          eligible: input.fileDrag === true || isFileSourceClass(input.sourceClass) || !!recentSource,
          shiftSeen: false,
        };
        onDiagnostic({ event: 'drag-started', sourceClass: input.sourceClass || '',
          source: recentSource ? 'recent-pointer' : 'pointer', eligible: drag.eligible });
        if (drag.eligible) onDragStart?.(recentSource ? {...input,sourceWindow:previous.sourceWindow,sourceClass:previous.sourceClass} : input);
        if (recentSource && /^sysdragimage$/i.test(input.sourceClass)) {
          // The shell has already started a drag. Preserve movement that took
          // place between polls so stopping, then pressing Shift still works.
          tracker.sample({ down: true, shift: false, x: previous.x, y: previous.y });
        }
      }
      if (input.shift && !drag.shiftSeen) {
        drag.shiftSeen = true;
        onDiagnostic({ event: 'shift-seen', eligible: drag.eligible });
      }
      // Explorer's title bar and resize border share its source window class.
      // The move/size loop can begin after mouse-down; reject the whole gesture
      // once Windows identifies it, including after the loop flag disappears.
      if (input.windowMove && !drag.windowMove) {
        drag.windowMove = true;
        drag.eligible = false;
        tracker.sample({ down: false });
        onDiagnostic({ event: 'window-move-rejected' });
      }
      // A macOS drag pasteboard is published after the initial mouse-down.
      // Only a confirmed file payload may upgrade an ineligible drag.
      if (!drag.eligible && !drag.windowMove && input.fileDrag === true) {
        drag.eligible = true;
        onDragStart?.(input);
      }
      tracker.sample({ ...input, eligible: drag.eligible });
    },
    reset() { previous = null; drag = null; tracker.reset(); },
  };
}

function createWindowsReader(koffi) {
  const user32 = koffi.load('user32.dll');
  const getAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
  const getSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)');
  const getCursorPos = user32.func('int __stdcall GetCursorPos(_Out_ void *lpPoint)');
  const pointType = koffi.struct({ x: 'int32', y: 'int32' });
  const windowFromPoint = user32.func('__stdcall', 'WindowFromPoint', 'void *', [pointType]);
  const getAncestor = user32.func('void * __stdcall GetAncestor(void *hWnd, unsigned int flags)');
  const getClassName = user32.func('int __stdcall GetClassNameW(void *hWnd, _Out_ void *lpClassName, int nMaxCount)');
  const getGuiThreadInfo = user32.func('int __stdcall GetGUIThreadInfo(uint32 idThread, void *pgui)');
  const point = Buffer.alloc(8), windowClass = Buffer.alloc(512);
  // GUITHREADINFO: two DWORDs, six HWNDs, then one RECT (48/72 bytes).
  const guiInfo = Buffer.alloc(8 + 6 * koffi.sizeof('void *') + 16);
  guiInfo.writeUInt32LE(guiInfo.length, 0);
  return () => {
    const down = getAsyncKeyState(getSystemMetrics(23) ? 0x02 : 0x01) < 0;
    if (!getCursorPos(point)) return { down };
    const x = point.readInt32LE(0), y = point.readInt32LE(4);
    const child = windowFromPoint({ x, y });
    const root = child ? getAncestor(child, 2 /* GA_ROOT */) || child : null;
    const length = root ? getClassName(root, windowClass, 256) : 0;
    const windowMove = down && !!getGuiThreadInfo(0, guiInfo) && !!(guiInfo.readUInt32LE(4) & 2 /* GUI_INMOVESIZE */);
    return { down, shift: getAsyncKeyState(0x10) < 0, x, y,
      windowMove,
      tools: getAsyncKeyState(0x12) < 0, sourceWindow: root ? koffi.address(root).toString() : null,
      sourceClass: length > 0 ? windowClass.toString('utf16le', 0, length * 2) : '' };
  };
}

function createMacReader(koffi) {
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  const canListen = cg.func('bool CGPreflightListenEventAccess(void)');
  if (!canListen()) throw new Error('Enable Sift in macOS Input Monitoring, then reopen Sift.');
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const key = cg.func('bool CGEventSourceKeyState(int state, unsigned short key)');
  const button = cg.func('bool CGEventSourceButtonState(int state, unsigned int button)');
  const create = cg.func('void * CGEventCreate(void *source)');
  const pointType = koffi.struct({ x: 'double', y: 'double' });
  const location = cg.func('CGEventGetLocation', pointType, ['void *']);
  const release = cf.func('void CFRelease(void *object)');
  // macOS drag pasteboard confirms a file payload before a wheel opens.
  const { createMacDragContext } = require('./drag-context.cjs');
  const context = createMacDragContext(koffi);
  let dragFiles = [], previousDown = false;
  return () => {
    const down = button(0, 0);
    if (!down) { dragFiles = []; previousDown = false; context.reset(); }
    if (down && (!previousDown || !dragFiles.length)) dragFiles = context();
    previousDown = down;
    const event = create(null);
    if (!event) return { down };
    let point;
    try { point = location(event); } finally { release(event); }
    return { down, shift: key(0, 56) || key(0, 60), tools: key(0, 55) || key(0, 54),
      ...point, sourceClass: '', fileDrag: dragFiles.length > 0, files: dragFiles };
  };
}

function requestMacGestureAccess() {
  if (process.platform !== 'darwin') return true;
  const cg = require('koffi').load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  return cg.func('bool CGRequestListenEventAccess(void)')();
}

function startGlobalGesture({ onTrigger, onRelease, onModeChange, onDragStart, onError, onDiagnostic, intervalMs = 16 } = {}) {
  let timer;
  let poller;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    poller?.reset();
    poller = undefined;
    stop.available = false;
  };
  stop.available = false;
  if (!['win32', 'darwin'].includes(process.platform)) return stop;
  try {
    const koffi = require('koffi');
    const read = process.platform === 'darwin' ? createMacReader(koffi) : createWindowsReader(koffi);
    poller = createGesturePoller({ read, onTrigger, onRelease, onModeChange, onDragStart, onDiagnostic });
    const poll = () => {
      try {
        poller.poll();
      } catch (error) {
        stop();
        onError?.(error);
      }
    };
    timer = setInterval(poll, Math.max(8, intervalMs));
    timer.unref?.();
    stop.available = true;
  } catch (error) {
    onError?.(error);
  }
  return stop;
}

module.exports = { startGlobalGesture, createGestureTracker, createGesturePoller, createWindowsReader, createMacReader, requestMacGestureAccess, isFileSourceClass };
