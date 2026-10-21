'use strict';

// The HEVC encoder runs away from Electron's main thread. Only already-decoded
// RGBA pixels enter this worker; source files are decoded by the newer decoder.
const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  // elheif's browser entry has an extensionless import that Node cannot load.
  // Its published WASM bootstrap is self-contained and accepts these callbacks.
  const bootstrap = path.join(path.dirname(require.resolve('elheif')), 'elheif-wasm.js');
  await import(pathToFileURL(bootstrap).href);
  const api = {};
  await new Promise((resolve, reject) => {
    api.onRuntimeInitialized = resolve;
    api.onAbort = message => reject(new Error(String(message)));
    globalThis.__init__ELHEIF_MODULE(api);
  });
  const result = api.jsEncodeImage(new Uint8Array(workerData.pixels), workerData.width, workerData.height);
  if (result.err || !result.data?.length) throw new Error(result.err || 'HEIC encoding failed.');
  const data = Uint8Array.from(result.data);
  parentPort.postMessage({ data }, [data.buffer]);
})().catch(error => parentPort.postMessage({ error: String(error.message || error) }));
