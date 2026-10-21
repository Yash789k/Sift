const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptFileDrag } = require('../src/drop-policy.js');

function drag(type, overrides = {}) {
  return {
    type, shiftKey: true, prevented: false,
    preventDefault() { this.prevented = true; },
    dataTransfer: { types: ['Files'], files: type === 'drop' ? [{}] : [], effectAllowed: 'copyMove', dropEffect: 'move', ...overrides },
  };
}

test('Shift-held file entry, hover and drop negotiate COPY instead of native MOVE', () => {
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const event = drag(type);
    assert.equal(acceptFileDrag(event), true);
    assert.equal(event.dataTransfer.dropEffect, 'copy');
    assert.equal(event.prevented, true);
  }
});

test('busy converters reject drops with NONE rather than accepting a move', () => {
  const event = drag('drop');
  assert.equal(acceptFileDrag(event, true), false);
  assert.equal(event.dataTransfer.dropEffect, 'none');
  assert.equal(event.prevented, true);
});

test('move-only sources and non-file content cannot negotiate a destructive import', () => {
  for (const effectAllowed of ['move', 'link', 'linkMove', 'none']) {
    const event = drag('dragover', { effectAllowed });
    assert.equal(acceptFileDrag(event), false);
    assert.equal(event.dataTransfer.dropEffect, 'none');
  }
  const text = drag('drop', { types: ['text/plain'], files: [] });
  assert.equal(acceptFileDrag(text), false);
  assert.equal(text.dataTransfer.dropEffect, 'none');
});

test('a file payload accepts copy when a drop does not repeat the Files type', () => {
  const event = drag('drop', { types: [], effectAllowed: 'all' });
  assert.equal(acceptFileDrag(event), true);
  assert.equal(event.dataTransfer.dropEffect, 'copy');
});
