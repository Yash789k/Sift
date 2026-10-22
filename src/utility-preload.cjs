'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('siftUtility', {
  snapshot: () => ipcRenderer.invoke('utility-snapshot'),
  action: request => ipcRenderer.invoke('utility-action', request),
  onSnapshot: callback => ipcRenderer.on('utility-snapshot', (_event, value) => callback(value)),
  onView: callback => ipcRenderer.on('utility-view', (_event, value) => callback(value)),
});
