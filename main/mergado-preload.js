// main/mergado-preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mergadoAPI", {
  goHome: () => ipcRenderer.invoke("reset-to-home"),
});
