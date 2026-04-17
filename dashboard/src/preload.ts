// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  loginWithGoogle: () => ipcRenderer.invoke('login-with-google'),
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
});
