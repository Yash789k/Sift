'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('Mac reader opens the system drag pasteboard, not an empty board named after its constant', { skip: process.platform !== 'darwin' }, () => {
  const koffi = require('koffi');
  const appkit = koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit');
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const selectorName = objc.func('const char * sel_getName(void *selector)');
  const selector = objc.func('void * sel_registerName(const char *name)');
  const text = objc.func('objc_msgSend', 'str', ['void *', 'void *']);
  const utf8 = selector('UTF8String');
  const systemName = text(koffi.decode(appkit.symbol('NSDragPboard', 'void *'), 'void *'), utf8);
  const opened = [];
  const observedKoffi = Object.create(koffi);
  observedKoffi.load = name => {
    const library = koffi.load(name);
    if (!name.endsWith('/libobjc.A.dylib')) return library;
    return { func(...args) {
      const native = library.func(...args);
      if (args[0] !== 'objc_msgSend' || args[2]?.join() !== 'void *,void *,void *') return native;
      return (object, method, argument) => {
        if (selectorName(method) === 'pasteboardWithName:') opened.push(text(argument, utf8));
        return native(object, method, argument);
      };
    } };
  };
  const read = require('../src/drag-context.cjs').createMacDragContext(observedKoffi);
  assert.deepEqual(read(), [], 'An unchanged pasteboard cannot replay a previous drag');
  assert.notEqual(systemName, 'NSDragPboard');
  assert.deepEqual(opened, [systemName, systemName]);
});
