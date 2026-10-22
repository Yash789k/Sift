'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (!process.argv[2]) throw new Error('Supply the packaged Sift executable.');
// PowerShell starts a GUI executable asynchronously. Wait for its actual result
// here, and exclude developer runtimes/toolchains from the child's search path.
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = process.platform === 'win32' ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : '/usr/bin:/bin';
const result = spawnSync(path.resolve(process.argv[2]), [path.join(__dirname, 'test-packaged.cjs')], {
  env, stdio: 'inherit', windowsHide: true, timeout: 120000,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 && !result.error ? 0 : 1;
