const packager = require('@electron/packager');
const path = require('node:path');
const { buildNative } = require('./build-native.cjs');
const metadata = require('../package.json');
const option = (name, fallback) => { const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]; };
const platform=option('--platform',process.platform),arch=option('--arch',process.arch);
if(!['win32','darwin'].includes(platform))throw Error('Build on Windows or macOS.');
if(platform!==process.platform||arch!==process.arch)throw Error('Build on the target OS and architecture so Sharp, canvas, Koffi and FFmpeg use the correct native binaries.');
buildNative();
packager({
  dir: path.resolve(__dirname,'..'),
  name: 'Sift',
  platform,
  arch,
  out: path.resolve(option('--out',path.join(__dirname,'..','dist'))),
  overwrite: true,
  icon: path.resolve(__dirname,'..','src',platform==='darwin'?'icon.icns':'icon.ico'),
  appCopyright: 'Sift contributors · GPL-3.0-or-later',
  appVersion: metadata.version,
  appBundleId: 'org.siftconverter.desktop',
  extendInfo: { LSUIElement:true, NSInputMonitoringUsageDescription:'Sift reads drag modifiers to show its file conversion wheel.' },
  win32metadata: { CompanyName: 'Sift', FileDescription: 'Sift — offline file converter', ProductName: 'Sift', InternalName: 'Sift' },
  ignore: [/^\/\.demo-data($|\/)/,/^\/\.git($|\/)/,/^\/\.github($|\/)/,/^\/tests($|\/)/,/^\/scripts($|\/)/,/^\/dist($|\/)/,/\.log$/],
  prune: true,
}).then(paths => console.log('Packaged Sift:', paths.join('\n'))).catch(error=>{console.error(error);process.exitCode=1;});
