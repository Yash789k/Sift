'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('siftCompletion', {
  ready: token => ipcRenderer.invoke('completion-ready', token),
  show: token => ipcRenderer.invoke('completion-show', token),
  onPresent: callback => ipcRenderer.on('completion-present', (_event, payload) => callback(payload)),
  onFade: callback => ipcRenderer.on('completion-fade', (_event, token) => callback(token)),
});
