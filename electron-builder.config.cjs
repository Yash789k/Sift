'use strict';

const signed = process.env.SIFT_SIGN === '1';
const notarize = process.env.SIFT_NOTARIZE === '1';
if (notarize && !signed) throw new Error('SIFT_NOTARIZE=1 requires SIFT_SIGN=1 and a Developer ID certificate.');

module.exports = {
  appId: 'org.siftconverter.desktop',
  productName: 'Sift',
  executableName: 'Sift',
  copyright: 'Copyright © 2026 Sift contributors',
  directories: { output: 'dist', buildResources: 'build' },
  // These dependencies contain native libraries, executable files and nested workers.
  // Keep their existing filesystem paths and target-platform prebuilt binaries intact.
  asar: false,
  npmRebuild: false,
  files: [
    'src/**/*',
    'engine.cjs',
    'tools-engine.cjs',
    'heic-worker.cjs',
    'samples/**/*',
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'DISTRIBUTION.md',
    'package.json',
    '!**/*.log',
    '!**/.DS_Store',
  ],
  publish: null,
  forceCodeSigning: signed,
  win: {
    target: ['nsis'],
    icon: 'src/icon.ico',
    requestedExecutionLevel: 'asInvoker',
    signAndEditExecutable: true,
    artifactName: 'Sift-${version}-windows-${arch}-setup.${ext}',
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: false,
    packElevateHelper: false,
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    shortcutName: 'Sift',
    uninstallDisplayName: 'Sift',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    differentialPackage: false,
    include: 'build/installer.nsh',
  },
  mac: {
    target: ['dmg'],
    icon: 'src/icon.icns',
    category: 'public.app-category.utilities',
    minimumSystemVersion: '13.0',
    extendInfo: {
      LSUIElement: true,
      NSInputMonitoringUsageDescription: 'Sift reads drag modifiers to show its file conversion wheel.',
    },
    // Explicit ad-hoc signing supports local Apple Silicon builds. It is not a
    // Developer ID signature or notarization and does not establish Gatekeeper trust.
    ...(signed ? {} : { identity: '-' }),
    hardenedRuntime: signed,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    binaries: ['Resources/app/node_modules/ffmpeg-static/ffmpeg'],
    notarize,
    artifactName: 'Sift-${version}-macos-${arch}.${ext}',
  },
  dmg: {
    title: 'Sift ${version}',
    backgroundColor: '#f6f1e9',
    window: { width: 540, height: 360 },
    contents: [
      { x: 150, y: 160, type: 'file' },
      { x: 390, y: 160, type: 'link', path: '/Applications' },
    ],
  },
};
