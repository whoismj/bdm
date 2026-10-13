const { app, BrowserWindow } = require("electron");
const path = require("path");

app.setName("odm-extension-preview");

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 345,
    height: 530,
    resizable: false,
    title: "ODM Extension Preview",
    backgroundColor: "#111218",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile(path.join(__dirname, "popup/popup.html"));
});
