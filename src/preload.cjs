const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('sift', {
  state: () => ipcRenderer.invoke('state'),
  chooseFiles: () => ipcRenderer.invoke('choose-files'),
  sample: () => ipcRenderer.invoke('sample'),
  preview: filePath => ipcRenderer.invoke('preview', filePath),
  inspectTools: paths => ipcRenderer.invoke('inspect-tools', paths),
  previewTool: request => ipcRenderer.invoke('tool-preview', request),
  runTool: request => ipcRenderer.invoke('run-tool', request),
  beginIngestion: () => ipcRenderer.invoke('ingestion-begin'),
  endIngestion: () => ipcRenderer.invoke('ingestion-end'),
  inspect: paths => ipcRenderer.invoke('inspect', paths),
  pathForFile: file => webUtils.getPathForFile(file),
  chooseOutput: () => ipcRenderer.invoke('choose-output'),
  convert: request => ipcRenderer.invoke('convert', request),
  cancel: () => ipcRenderer.invoke('cancel'),
  showResult: path => ipcRenderer.invoke('show-result', path),
  openOutput: () => ipcRenderer.invoke('open-output'),
  setGesture: enabled => ipcRenderer.invoke('gesture', enabled),
  window: action => ipcRenderer.invoke('window', action),
  on: (event, callback) => {
    if (!['mode', 'progress', 'state', 'gesture-status'].includes(event)) return;
    ipcRenderer.on(event, (_event, value) => callback(value));
  },
});
