import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openGoogleAuth: () => ipcRenderer.send('open-google-auth'),
});