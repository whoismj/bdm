// Boring Download Manager (BDM) — Background Service Worker
// Handles real-time download interception, context menus, native messaging, and local REST API fallback.

const NATIVE_HOSTS = ["com.boring.dm", "com.omarchy.dm"];
const HTTP_BRIDGE_URL = "http://127.0.0.1:19532";

// In-memory set of handled download IDs to prevent interception loops
const handledDownloads = new Set();

// Default Settings
const DEFAULT_SETTINGS = {
  interceptDownloads: true,
  interceptMinSizeMB: 0,
  captureVideo: true,
  autoStart: true,
  connections: 8,
  showNotifications: true,
  ignoredExtensions: ["crx", "xpi", "torrent"]
};

// Initialize Settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(null);
  const updated = { ...DEFAULT_SETTINGS, ...current };
  await chrome.storage.local.set(updated);
  setupContextMenus();
});

// Setup Context Menus
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "bdm-download-link",
      title: "Download with BDM",
      contexts: ["link"]
    });

    chrome.contextMenus.create({
      id: "bdm-download-media",
      title: "Download Video / Audio with BDM",
      contexts: ["video", "audio"]
    });

    chrome.contextMenus.create({
      id: "bdm-download-image",
      title: "Download Image with BDM",
      contexts: ["image"]
    });

    chrome.contextMenus.create({
      id: "bdm-download-selection",
      title: "Download Link in Selection with BDM",
      contexts: ["selection"]
    });

    chrome.contextMenus.create({
      id: "bdm-open-modal",
      title: "Open in BDM...",
      contexts: ["page"]
    });
  });
}

// Context Menu Action Handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let targetUrl = "";
  let isMedia = false;
  let category = null;

  if (info.menuItemId === "bdm-download-link") {
    targetUrl = info.linkUrl;
  } else if (info.menuItemId === "bdm-download-media") {
    targetUrl = info.srcUrl;
    isMedia = true;
    category = "Video";
  } else if (info.menuItemId === "bdm-download-image") {
    targetUrl = info.srcUrl;
    category = "Images";
  } else if (info.menuItemId === "bdm-download-selection") {
    const text = (info.selectionText || "").trim();
    if (text.startsWith("http://") || text.startsWith("https://")) {
      targetUrl = text;
    }
  } else if (info.menuItemId === "bdm-open-modal") {
    sendToBDM({ action: "open_add_modal", url: tab ? tab.url : "", open_gui: true });
    return;
  }

  if (targetUrl) {
    const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
    const filename = getFilenameFromUrl(targetUrl);
    await sendToBDM({
      action: "open_add_modal",
      url: targetUrl,
      filename: filename,
      referer: tab ? tab.url : "",
      category: category,
      is_media: isMedia,
      connections: settings.connections || 8,
      open_gui: true
    });

    if (settings.showNotifications) {
      notifyUser("BDM Download Dispatched", `Opening Boring Download Manager:\n${filename}`);
    }
  }
});

// Download Interception via chrome.downloads.onCreated
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  try {
    const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
    if (!settings.interceptDownloads) return;

    if (!downloadItem.url || downloadItem.url.startsWith("blob:") || downloadItem.url.startsWith("data:")) {
      return;
    }

    if (handledDownloads.has(downloadItem.id)) return;
    handledDownloads.add(downloadItem.id);

    // Filter ignored extensions (like extensions or torrents)
    const ext = getExtension(downloadItem.filename || downloadItem.url);
    if (ext && (settings.ignoredExtensions || []).includes(ext.toLowerCase())) {
      return;
    }

    // Filter min size if specified
    if (settings.interceptMinSizeMB > 0 && downloadItem.totalBytes > 0) {
      const sizeMB = downloadItem.totalBytes / (1024 * 1024);
      if (sizeMB < settings.interceptMinSizeMB) return;
    }

    // Cancel browser native download immediately
    try {
      await chrome.downloads.cancel(downloadItem.id);
      await chrome.downloads.erase({ id: downloadItem.id });
    } catch (_) {}

    const filename = downloadItem.filename ? downloadItem.filename.split("/").pop().split("\\").pop() : getFilenameFromUrl(downloadItem.url);
    const targetUrl = downloadItem.finalUrl || downloadItem.url;

    // Immediately open BDM with the Add Download modal!
    const res = await sendToBDM({
      action: "open_add_modal",
      url: targetUrl,
      filename: filename,
      referer: downloadItem.referrer || "",
      connections: settings.connections || 8,
      open_gui: true
    });

    if (settings.showNotifications) {
      notifyUser("BDM Intercepted Download", `Opening Boring Download Manager:\n${filename}`);
    }
  } catch (err) {
    console.error("BDM download intercept error:", err);
  }
});

// Dual-Transport Communication: Native Messaging (Primary) + HTTP Bridge (Fallback)
async function sendToBDM(message) {
  // 1. Try Native Messaging Hosts
  for (const hostName of NATIVE_HOSTS) {
    try {
      const nativeResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendNativeMessage(hostName, message, (resp) => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          resolve(resp);
        });
      });
      if (nativeResp && (nativeResp.status === "ok" || nativeResp.res)) {
        return nativeResp;
      }
    } catch (_) {
      // Try next host name
    }
  }

  // 2. Fallback to Local REST HTTP Bridge
  try {
    const endpoint = message.action === "open_add_modal" ? "/api/open_modal" : "/api/add";
    const res = await fetch(`${HTTP_BRIDGE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("BDM HTTP Bridge unreachable:", err);
  }

  return { status: "error", message: "Cannot reach BDM daemon" };
}

// Status check (queries both Native Host & HTTP bridge)
async function checkBDMStatus() {
  // Try HTTP bridge first for speed
  try {
    const res = await fetch(`${HTTP_BRIDGE_URL}/api/stats`, { method: "GET" });
    if (res.ok) {
      const data = await res.json();
      return { connected: true, transport: "http", ...data };
    }
  } catch (_) {}

  // Try Native Messaging
  for (const hostName of NATIVE_HOSTS) {
    try {
      const nativeResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendNativeMessage(hostName, { action: "ping" }, (resp) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(resp);
        });
      });
      if (nativeResp) {
        return { connected: true, transport: "native", ...nativeResp };
      }
    } catch (_) {}
  }

  return { connected: false, speed: 0, active: 0, total: 0 };
}

// Runtime Message Handling (from popup or content script)
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === "CHECK_STATUS") {
    checkBDMStatus().then(sendResponse);
    return true; // asynchronous response
  }

  if (req.type === "DISPATCH_DOWNLOAD") {
    sendToBDM({
      action: "open_add_modal",
      url: req.url,
      filename: req.filename,
      referer: sender.tab ? sender.tab.url : "",
      category: req.category,
      is_media: req.is_media || false,
      quality: req.quality || "best",
      open_gui: true
    }).then(sendResponse);
    return true;
  }

  if (req.type === "OPEN_APP") {
    sendToBDM({ action: "open_add_modal", url: req.url || "", open_gui: true }).then(sendResponse);
    return true;
  }
});

// Helpers
function notifyUser(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-48.png",
      title: title,
      message: message,
      priority: 1
    });
  } catch (_) {}
}

function getFilenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const name = path.split("/").pop();
    return name ? decodeURIComponent(name) : "download";
  } catch (_) {
    return "download";
  }
}

function getExtension(filename) {
  if (!filename) return "";
  const parts = filename.split("?")[0].split(".");
  return parts.length > 1 ? parts.pop() : "";
}
