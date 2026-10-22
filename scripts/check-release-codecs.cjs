'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function checkReleaseCodecs(root = path.resolve(__dirname, '..')) {
  const evidence = JSON.parse(fs.readFileSync(path.join(root, 'build/release-codecs.json'), 'utf8'));
  if (evidence.platform !== process.platform || evidence.arch !== process.arch) throw new Error('Release codecs do not match this host.');
  for (const item of [evidence.ffmpeg, evidence.heic]) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, item.path))).digest('hex');
    if (actual !== item.sha256) throw new Error(`Release codec changed: ${item.path}`);
  }
  if (evidence.ffmpeg.version.includes('--enable-nonfree')) throw new Error('Nonfree FFmpeg cannot be released.');
}
module.exports = { checkReleaseCodecs };
if (require.main === module) checkReleaseCodecs();
