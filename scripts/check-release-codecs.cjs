'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
function checkReleaseCodecs(root = path.resolve(__dirname, '..'), { afterSigning = false } = {}) {
  const evidence = JSON.parse(fs.readFileSync(path.join(root, 'build/release-codecs.json'), 'utf8'));
  if (evidence.platform !== process.platform || evidence.arch !== process.arch) throw new Error('Release codecs do not match this host.');
  for (const item of [evidence.ffmpeg, evidence.heic]) {
    const file = path.join(root, item.path);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    // The packager adds a Mac code signature after the pre-packaging hash check.
    // Verify that signature and the recorded build configuration after signing.
    if (afterSigning && process.platform === 'darwin' && item === evidence.ffmpeg) {
      execFileSync('/usr/bin/codesign', ['--verify', '--strict', file]);
    } else if (actual !== item.sha256) throw new Error(`Release codec changed: ${item.path}`);
  }
  const version = execFileSync(path.join(root, evidence.ffmpeg.path), ['-version'], { encoding: 'utf8' });
  if (version !== evidence.ffmpeg.version) throw new Error('Release FFmpeg build configuration changed.');
  if (evidence.ffmpeg.version.includes('--enable-nonfree')) throw new Error('Nonfree FFmpeg cannot be released.');
}
module.exports = { checkReleaseCodecs };
if (require.main === module) checkReleaseCodecs();
