'use strict';
// Run only in the packaging regression subprocess, never in the shipped app.
const native = require('../../scripts/build-native.cjs');
native.buildNative = () => {};
const filename = require.resolve('electron-builder');
require.cache[filename] = { id: filename, filename, loaded: true, exports: {
  Platform: { WINDOWS: { createTarget: () => new Map() }, MAC: { createTarget: () => new Map() } },
  Arch: { x64: 1, arm64: 3 },
  build: async () => {
    process.on('exit', () => { process.exitCode = 0; });
    throw new Error('Simulated signing failure');
  }
} };
