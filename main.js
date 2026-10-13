const { app, BrowserWindow, ipcMain, clipboard, dialog, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execSync } = require("child_process");

app.setName("bdm");

let mainWindow = null;
let tray = null;
let isQuitting = false;
let minimizeToTray = true;
let daemonProc = null;
let daemonStdoutBuffer = "";
const pendingRequests = new Map();

function focusMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    focusMainWindow();
    const urlArg = commandLine.find(arg => arg && (arg.startsWith("http://") || arg.startsWith("https://")));
    if (urlArg && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("daemon:event", { event: "open_add_modal", url: urlArg });
    }
  });
}

const THEME_FILE = path.join(
  os.homedir(),
  ".local/state/omarchy/current/theme/colors.toml"
);
const ICON_PATH = path.join(__dirname, "icon.svg");

// Parse TOML colors safely
function getOmarchyColors() {
  const defaults = {
    mode: "dark",
    background: "#222222",
    darker_background: "#121212",
    dark_background: "#191919",
    lighter_background: "#2c2c2c",
    foreground: "#c2c2b0",
    dark_foreground: "#555555",
    light_foreground: "#8a8a7e",
    bright_foreground: "#ebebe0",
    accent: "#78824b",
    selection: "#383838",
    muted: "#666666",
    red: "#a3483b",
    yellow: "#b36d43",
    orange: "#8d6242",
    green: "#5f875f",
    cyan: "#c9a554",
    blue: "#78824b",
    magenta: "#bb7744"
  };

  try {
    if (fs.existsSync(THEME_FILE)) {
      const content = fs.readFileSync(THEME_FILE, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*["']([^"']+)["']/);
        if (match) {
          defaults[match[1]] = match[2];
        }
      }
    }
  } catch (err) {
    console.error("Error reading theme file:", err);
  }
  return defaults;
}

function getOmarchyFont() {
  try {
    const out = execSync("omarchy font current 2>/dev/null", { encoding: "utf-8" }).trim();
    if (out) return out;
  } catch (_) {}
  return "JetBrainsMono Nerd Font";
}

function startDaemon() {
  const daemonScript = path.join(__dirname, "daemon.py");
  daemonProc = spawn("python3", [daemonScript], {
    cwd: __dirname,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" }
  });

  daemonProc.stdout.on("data", (chunk) => {
    daemonStdoutBuffer += chunk.toString();
    const lines = daemonStdoutBuffer.split("\n");
    daemonStdoutBuffer = lines.pop(); // keep remainder

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.res || msg.event === "init") {
          console.log("[main <- daemon]", msg.res || msg.event, msg.req_id || "");
        }

        // Check if matching a pending request
        if (msg.req_id && pendingRequests.has(msg.req_id)) {
          const req = pendingRequests.get(msg.req_id);
          pendingRequests.delete(msg.req_id);
          clearTimeout(req.timeout);
          req.resolve(msg);
        }

        // Forward to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("daemon:event", msg);
          if (msg.event === "open_add_modal" || msg.event === "open_options_modal" || msg.event === "focus_window" || msg.event === "task_added") {
            focusMainWindow();
          }
        }
      } catch (err) {
        console.error("Failed to parse daemon JSON:", trimmed, err);
      }
    }
  });

  daemonProc.stderr.on("data", (chunk) => {
    console.error("Daemon stderr:", chunk.toString());
  });

  daemonProc.on("close", (code) => {
    console.log("Daemon exited with code:", code);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("daemon:closed", code);
    }
  });
}

function sendToDaemon(data) {
  return new Promise((resolve, reject) => {
    if (!daemonProc || daemonProc.killed || !daemonProc.stdin.writable) {
      return reject(new Error("Daemon is not running"));
    }

    const req_id = "req_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    data.req_id = req_id;

    const timeout = setTimeout(() => {
      if (pendingRequests.has(req_id)) {
        pendingRequests.delete(req_id);
        reject(new Error("Daemon request timed out: " + data.cmd));
      }
    }, 120000);

    pendingRequests.set(req_id, { resolve, reject, timeout });

    daemonProc.stdin.write(JSON.stringify(data) + "\n");
  });
}

function createWindow() {
  const colors = getOmarchyColors();

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 840,
    minHeight: 560,
    title: "Boring Download Manager (BDM)",
    icon: ICON_PATH,
    backgroundColor: colors.dark_background || "#191919",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[Renderer L${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting && minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  if (tray) return;

  const trayIconPath = path.join(__dirname, "browser-extension/icons/icon-32.png");
  const icon = nativeImage.createFromPath(trayIconPath);
  tray = new Tray(icon);
  tray.setToolTip("Boring Download Manager (BDM)");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Boring Download Manager",
      click: () => {
        focusMainWindow();
      }
    },
    {
      label: "Add Download URL...",
      click: () => {
        focusMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("daemon:event", { event: "open_add_modal" });
        }
      }
    },
    { type: "separator" },
    {
      label: "Resume All Downloads",
      click: () => {
        sendToDaemon({ cmd: "resume_all" }).catch(() => {});
      }
    },
    {
      label: "Pause All Downloads",
      click: () => {
        sendToDaemon({ cmd: "stop_all" }).catch(() => {});
      }
    },
    { type: "separator" },
    {
      label: "Browser Integration...",
      click: () => {
        focusMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("daemon:event", { event: "open_options_modal", tab: "extensions" });
        }
      }
    },
    {
      label: "Settings & Options...",
      click: () => {
        focusMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("daemon:event", { event: "open_options_modal", tab: "general" });
        }
      }
    },
    { type: "separator" },
    {
      label: "Quit Boring Download Manager",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        if (mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          focusMainWindow();
        }
      } else {
        focusMainWindow();
      }
    } else {
      createWindow();
    }
  });

  // Watch for Omarchy theme changes
  try {
    if (fs.existsSync(THEME_FILE)) {
      fs.watch(THEME_FILE, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const updatedColors = getOmarchyColors();
          const updatedFont = getOmarchyFont();
          mainWindow.webContents.send("theme:changed", {
            colors: updatedColors,
            font: updatedFont
          });
        }
      });
    }
  } catch (err) {
    console.error("Theme watcher error:", err);
  }
}

// IPC Handlers
ipcMain.handle("daemon:cmd", async (_event, data) => {
  return await sendToDaemon(data);
});

ipcMain.handle("theme:get", async () => {
  return {
    colors: getOmarchyColors(),
    font: getOmarchyFont()
  };
});

ipcMain.handle("system:openFile", async (_event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      spawn("xdg-open", [filePath], { detached: true, stdio: "ignore" });
      return { success: true };
    }
    return { success: false, error: "File not found" };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("system:openFolder", async (_event, targetPath) => {
  try {
    let folder = targetPath;
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
      folder = path.dirname(targetPath);
    }
    spawn("xdg-open", [folder], { detached: true, stdio: "ignore" });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("system:chooseDirectory", async (_event, defaultPath) => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Select Download Directory",
      defaultPath: defaultPath || path.join(os.homedir(), "Downloads"),
      properties: ["openDirectory", "createDirectory"]
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return { success: true, path: res.filePaths[0] };
    }
    return { success: false, canceled: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("system:getClipboard", async () => {
  try {
    return { text: clipboard.readText() };
  } catch (err) {
    return { text: "" };
  }
});

ipcMain.handle("system:copy", async (_event, text) => {
  try {
    clipboard.writeText(text);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("system:notify", async (_event, { title, body }) => {
  try {
    spawn("notify-send", ["-a", "Boring Download Manager", "-i", ICON_PATH, title, body], {
      detached: true,
      stdio: "ignore"
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("system:openExternal", async (_event, url) => {
  try {
    const { shell } = require("electron");
    if (url) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: "Empty URL" };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("browser:getStatus", async () => {
  try {
    const res = await sendToDaemon({ cmd: "browser_status" });
    if (res && res.browsers) return res.browsers;
  } catch (_) {}
  try {
    const script = path.join(__dirname, "browser_integration.py");
    const out = execSync(`python3 "${script}" --status`, { encoding: "utf-8" });
    return JSON.parse(out);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("browser:install", async (_event, browserId) => {
  try {
    const res = await sendToDaemon({ cmd: "browser_install", browser: browserId || "all" });
    if (res && res.result) return res.result;
  } catch (_) {}
  try {
    const script = path.join(__dirname, "browser_integration.py");
    const out = execSync(`python3 "${script}" --install="${browserId || 'all'}"`, { encoding: "utf-8" });
    return JSON.parse(out);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("system:setMinimizeToTray", async (_event, val) => {
  minimizeToTray = Boolean(val);
  return { success: true, minimizeToTray };
});

app.whenReady().then(() => {
  startDaemon();
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  if (tray) {
    try { tray.destroy(); } catch (_) {}
  }
  if (daemonProc && !daemonProc.killed) {
    try {
      daemonProc.kill("SIGTERM");
    } catch (_) {}
  }
});

app.on("window-all-closed", () => {
  if (isQuitting || !minimizeToTray) {
    if (daemonProc && !daemonProc.killed) {
      try {
        daemonProc.kill("SIGTERM");
      } catch (_) {}
    }
    if (process.platform !== "darwin") {
      app.quit();
    }
  }
});
