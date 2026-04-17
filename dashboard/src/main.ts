import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'node:path';
import crypto from 'node:crypto';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

let authToken: string | null = null;
let activeSessionId: string | null = null;
let pollingInterval: NodeJS.Timeout | null = null;
let pollingTimeout: NodeJS.Timeout | null = null;

ipcMain.handle('login-with-google', async () => {
  // Cancel existing login
  if (pollingInterval) clearInterval(pollingInterval);
  if (pollingTimeout) clearTimeout(pollingTimeout);
  
  authToken = null; // Clear previous token on new login attempt
  activeSessionId = crypto.randomBytes(16).toString('hex');
  
  const loginUrl = `http://127.0.0.1:8000/auth/google/login?session_id=${activeSessionId}`;
  shell.openExternal(loginUrl);
  
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes (polling every 1 second)
    
    pollingInterval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`http://127.0.0.1:8000/auth/session/${activeSessionId}`);
        const data = await res.json() as any;
        
        if (data.status === 'success') {
          clearInterval(pollingInterval!);
          clearTimeout(pollingTimeout!);
          authToken = data.token;
          activeSessionId = null;
          resolve({ user: data.user });
        } else if (data.status === 'expired') {
          clearInterval(pollingInterval!);
          clearTimeout(pollingTimeout!);
          activeSessionId = null;
          reject(new Error("Login session expired"));
        }
      } catch (err) {
        // Ignore fetch errors during polling, backend might be busy
      }
      
      if (attempts >= maxAttempts) {
        clearInterval(pollingInterval!);
        activeSessionId = null;
        reject(new Error("Login timeout"));
      }
    }, 1000);
    
    // Safety timeout
    pollingTimeout = setTimeout(() => {
      if (pollingInterval) clearInterval(pollingInterval);
      activeSessionId = null;
      reject(new Error("Login timeout"));
    }, 130000); // 2 minutes and 10 seconds
  });
});

ipcMain.handle('get-auth-token', async () => {
  if (!authToken) {
    return { error: "Authentication required", token: null };
  }
  return { error: null, token: authToken };
});
