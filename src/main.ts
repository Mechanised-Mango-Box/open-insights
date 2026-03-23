import { app, BrowserWindow } from "electron";
import { PluginManager } from "./plugin.js";

const pm: PluginManager = new PluginManager();

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600
  })

  win.loadFile('./src/index.html')
}

app.whenReady().then(() => {
  pm.initAll()

  createWindow();
})