'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildNative } = require('./build-native.cjs');
const config = require('../electron-builder.config.cjs');
const root = path.resolve(__dirname, '..');

function parseOptions(args) {
  const options = { platform: process.platform, arch: process.arch, out: path.join(root, 'dist'), dir: false, check: false };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--dir' || key === '--check') options[key.slice(2)] = true;
    else if (['--platform', '--arch', '--out'].includes(key)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}.`);
      options[key.slice(2)] = value;
    } else throw new Error(`Unknown packaging option: ${key}.`);
  }
  return options;
}

function checkConfig() {
  const { validateSchema } = require('app-builder-lib/out/util/config/schemaValidator');
  validateSchema(require('app-builder-lib/scheme.json'), config, { name: 'Sift packaging' });
  for (const file of ['src/main.cjs', 'src/icon.ico', 'src/icon.icns', 'engine.cjs', 'tools-engine.cjs', 'heic-worker.cjs', 'build/installer.nsh', 'build/entitlements.mac.plist']) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing package input: ${file}`);
  }
  if (config.publish !== null || config.nsis.perMachine || config.nsis.allowElevation || !config.mac.extendInfo.LSUIElement) {
    throw new Error('Packaging must stay local, per-user and a macOS menu-bar utility.');
  }
}

function checkNotarizationEnvironment() {
  if (process.env.SIFT_NOTARIZE !== '1') return;
  const complete = keys => keys.every(key => Boolean(process.env[key]));
  if (!complete(['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) &&
      !complete(['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) &&
      !complete(['APPLE_KEYCHAIN_PROFILE'])) {
    throw new Error('SIFT_NOTARIZE=1 requires complete Apple notarization credentials; see DISTRIBUTION.md.');
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  checkConfig();
  if (options.check) {
    console.log('Package configuration is valid. No build, signing or upload was performed.');
    return;
  }
  if (!['win32', 'darwin'].includes(options.platform)) throw new Error('Build on Windows or macOS.');
  if (options.platform !== process.platform || options.arch !== process.arch) {
    throw new Error('Build on the target OS and CPU architecture so Sharp, canvas, Koffi and FFmpeg use the correct native binaries.');
  }
  if (!['x64', 'arm64'].includes(options.arch)) throw new Error('Only x64 and arm64 builds are supported.');
  if (options.platform === 'win32' && options.arch !== 'x64') throw new Error('Windows builds require x64: ffmpeg-static does not supply a Windows arm64 binary.');
  if (process.env.SIFT_NOTARIZE === '1' && options.platform !== 'darwin') throw new Error('Apple notarization requires a macOS build host.');
  checkNotarizationEnvironment();
  buildNative();
  const { build, Platform, Arch } = require('electron-builder');
  const platform = options.platform === 'win32' ? Platform.WINDOWS : Platform.MAC;
  const target = options.dir ? 'dir' : options.platform === 'win32' ? 'nsis' : 'dmg';
  const artifacts = await build({
    projectDir: root,
    targets: platform.createTarget(target, Arch[options.arch]),
    config: { ...config, directories: { ...config.directories, output: path.resolve(options.out) } },
    publish: 'never',
  });
  console.log('Built Sift locally:', artifacts.join('\n') || path.resolve(options.out));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseOptions, checkConfig };
