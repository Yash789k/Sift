'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyBuildArtifacts } = require('../scripts/package.cjs');
const version = require('../package.json').version;

test('a packaging/signing error exits nonzero even if a dependency resets the exit code', { skip: !['win32', 'darwin'].includes(process.platform) }, () => {
  const result = spawnSync(process.execPath, ['--require', path.join(__dirname, 'fixtures/failing-package-preload.cjs'), path.join(__dirname, '../scripts/package.cjs')],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.match(result.stderr, /Simulated signing failure/);
  assert.equal(result.status, 1);
});

test('packaging requires a reported, existing, nonempty installer for each target', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-package-check-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64']]) {
    const name = platform === 'win32' ? `Sift-${version}-windows-${arch}-setup.exe` : `Sift-${version}-macos-${arch}.dmg`;
    const installer = path.join(out, name), options = { out, platform, arch, dir: false };
    assert.throws(() => verifyBuildArtifacts([], options), /did not produce/);
    assert.throws(() => verifyBuildArtifacts([installer], options), { code: 'ENOENT' });
    fs.writeFileSync(installer, '');
    assert.throws(() => verifyBuildArtifacts([installer], options), /empty or invalid/);
    fs.writeFileSync(installer, 'fixture installer');
    assert.deepEqual(verifyBuildArtifacts([installer], options), [installer]);
    assert.throws(() => verifyBuildArtifacts([], options), /did not produce/, 'an old installer cannot mask a failed build');
  }
});
