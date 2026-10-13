const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Daemon commands
  sendCmd: (cmd, payload = {}) => {
    return ipcRenderer.invoke("daemon:cmd", { cmd, ...payload });
  },

  // Daemon events listener
  onDaemonEvent: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on("daemon:event", handler);
    return () => ipcRenderer.removeListener("daemon:event", handler);
  },

  onDaemonClosed: (callback) => {
    const handler = (_event, code) => callback(code);
    ipcRenderer.on("daemon:closed", handler);
    return () => ipcRenderer.removeListener("daemon:closed", handler);
  },

  // Theme
  getTheme: () => ipcRenderer.invoke("theme:get"),
  onThemeChanged: (callback) => {
    const handler = (_event, theme) => callback(theme);
    ipcRenderer.on("theme:changed", handler);
    return () => ipcRenderer.removeListener("theme:changed", handler);
  },

  // System actions
  openFile: (filePath) => ipcRenderer.invoke("system:openFile", filePath),
  openFolder: (targetPath) => ipcRenderer.invoke("system:openFolder", targetPath),
  chooseDirectory: (defaultPath) => ipcRenderer.invoke("system:chooseDirectory", defaultPath),
  getClipboard: () => ipcRenderer.invoke("system:getClipboard"),
  copyToClipboard: (text) => ipcRenderer.invoke("system:copy", text),
  notify: (title, body) => ipcRenderer.invoke("system:notify", { title, body }),
  openExternal: (url) => ipcRenderer.invoke("system:openExternal", url),
  setMinimizeToTray: (enabled) => ipcRenderer.invoke("system:setMinimizeToTray", enabled),

  // Browser Integration
  getBrowserStatus: () => ipcRenderer.invoke("browser:getStatus"),
  installBrowserExtension: (browserId) => ipcRenderer.invoke("browser:install", browserId)
});
