const { contextBridge, ipcRenderer } = require("electron");

// API sécurisée exposée à l'interface (contextIsolation activé).
contextBridge.exposeInMainWorld("nexus", {
  getStatus: () => ipcRenderer.invoke("nexus:get-status"),
  refreshPairing: () => ipcRenderer.invoke("nexus:refresh-pairing"),
  getAutoLaunch: () => ipcRenderer.invoke("nexus:get-autolaunch"),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("nexus:set-autolaunch", enabled),
  openExternal: (url) => ipcRenderer.invoke("nexus:open-external", url),
});
