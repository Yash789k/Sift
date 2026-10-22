'use strict';

// CI supplies these directories from the source builds in this same workflow.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const [ffmpegDir, heicDir] = process.argv.slice(2).map(p => path.resolve(p));
if (!ffmpegDir || !heicDir) throw new Error('Supply the FFmpeg and HEIC artifact directories.');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = require('./codecs/sources.json');
for (const [group, dir] of [['ffmpeg', ffmpegDir], ['heic', heicDir]]) {
  for (const entry of manifest.filter(entry => entry.groups.includes(group))) {
    if (sha256(path.join(dir, 'sources', entry.file)) !== entry.sha256) throw new Error(`Invalid source archive: ${entry.file}`);
  }
}
const destination = require('ffmpeg-static');
const binary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
fs.copyFileSync(path.join(ffmpegDir, 'result', binary), destination);
fs.chmodSync(destination, 0o755);
const version = execFileSync(destination, ['-version'], { encoding: 'utf8' });
if (!version.includes('ffmpeg version 8.1.3') || version.includes('--enable-nonfree')) throw new Error('Unexpected or nonredistributable FFmpeg build.');
for (const encoder of ['libx264', 'libvpx', 'libmp3lame', 'libopus', 'libvorbis']) {
  if (!version.includes(`--enable-${encoder}`)) throw new Error(`Missing media encoder: ${encoder}`);
}
fs.copyFileSync(path.join(ffmpegDir, 'result', 'ffmpeg-license.txt'), `${destination}.LICENSE`);
fs.writeFileSync(`${destination}.README`, version + '\nBuilt by Sift from scripts/codecs/sources.json. Matching source accompanies the release.\n');
const encoderPath = path.join(path.dirname(require.resolve('elheif')), 'elheif-wasm.js');
fs.copyFileSync(path.join(heicDir, 'result', 'elheif-wasm.js'), encoderPath);
const licenses = path.join(root, 'licenses', 'codecs');
fs.mkdirSync(licenses, { recursive: true });
for (const [dir, names] of [[ffmpegDir, ['COPYING.GPLv3', 'COPYING.LGPLv3', 'LICENSE.md', 'ffmpeg-version.txt', 'ffmpeg-license.txt']],
  [heicDir, ['elheif-LICENSE', 'libheif-COPYING', 'kvazaar-LICENSE', 'emscripten-version.txt']]]) {
  for (const name of names) fs.copyFileSync(path.join(dir, 'result', name), path.join(licenses, name));
}
const evidence = {
  platform: process.platform, arch: process.arch,
  ffmpeg: { path: path.relative(root, destination), sha256: sha256(destination), version },
  heic: { path: path.relative(root, encoderPath), sha256: sha256(encoderPath) },
  sources: manifest,
};
fs.writeFileSync(path.join(root, 'build', 'release-codecs.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log('Installed and verified codecs built from locked source.');
