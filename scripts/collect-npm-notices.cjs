'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const directories = execFileSync(npm, ['ls', '--omit=dev', '--all', '--parseable'], {
  cwd: root, encoding: 'utf8', shell: process.platform === 'win32',
}).trim().split(/\r?\n/).filter(dir => dir !== root);
const destination = path.join(root, 'licenses', 'npm');
fs.mkdirSync(destination, { recursive: true });
const packages = [];
for (const directory of directories) {
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  packages.push({ name: pkg.name, version: pkg.version, license: pkg.license, repository: pkg.repository });
  const out = path.join(destination, `${pkg.name.replaceAll('/', '__')}@${pkg.version}`);
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(directory, 'package.json'), path.join(out, 'package.json'));
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && /^(licen[cs]e|copying|copyright|notice|authors)([.\-_]|$)/i.test(entry.name)) {
      fs.copyFileSync(path.join(directory, entry.name), path.join(out, entry.name));
    }
  }
}
fs.writeFileSync(path.join(destination, 'packages.json'), JSON.stringify(packages, null, 2) + '\n');
console.log(`Preserved notices for ${packages.length} production packages.`);

// macOS packaging starts from Electron.app; the adjacent distribution notices
// would otherwise be left outside the resulting app bundle.
const runtimeNotices = path.join(root, 'licenses', 'electron');
fs.mkdirSync(runtimeNotices, { recursive: true });
for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
  fs.copyFileSync(path.join(root, 'node_modules', 'electron', 'dist', name), path.join(runtimeNotices, name));
}
