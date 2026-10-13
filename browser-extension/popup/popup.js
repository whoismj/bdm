// Boring Download Manager (BDM) — Extension Popup Logic

document.addEventListener("DOMContentLoaded", async () => {
  const statusPill = document.getElementById("status-pill");
  const statusText = document.getElementById("status-text");
  const metricSpeed = document.getElementById("metric-speed");
  const metricActive = document.getElementById("metric-active");

  const inputUrl = document.getElementById("input-url");
  const btnPaste = document.getElementById("btn-paste");
  const selectCategory = document.getElementById("select-category");
  const btnDownload = document.getElementById("btn-download");
  const btnOpenGui = document.getElementById("btn-open-gui");

  const toggleIntercept = document.getElementById("toggle-intercept");
  const toggleVideo = document.getElementById("toggle-video");
  const toggleAutostart = document.getElementById("toggle-autostart");

  const hasChrome = typeof chrome !== "undefined" && chrome.runtime && chrome.storage;

  // Load and apply saved settings
  let settings = {
    interceptDownloads: true,
    captureVideo: true,
    autoStart: true
  };

  if (hasChrome && chrome.storage.local) {
    try {
      const saved = await chrome.storage.local.get(settings);
      settings = { ...settings, ...saved };
    } catch (_) {}
  }

  toggleIntercept.checked = settings.interceptDownloads;
  toggleVideo.checked = settings.captureVideo;
  toggleAutostart.checked = settings.autoStart;

  toggleIntercept.addEventListener("change", () => {
    if (hasChrome && chrome.storage.local) {
      chrome.storage.local.set({ interceptDownloads: toggleIntercept.checked });
    }
  });

  toggleVideo.addEventListener("change", () => {
    if (hasChrome && chrome.storage.local) {
      chrome.storage.local.set({ captureVideo: toggleVideo.checked });
    }
  });

  toggleAutostart.addEventListener("change", () => {
    if (hasChrome && chrome.storage.local) {
      chrome.storage.local.set({ autoStart: toggleAutostart.checked });
    }
  });

  // Paste from clipboard
  btnPaste.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
        inputUrl.value = text.trim();
        inputUrl.focus();
      }
    } catch (_) {
      inputUrl.focus();
    }
  });

  // Trigger Download
  async function triggerDownload() {
    const url = inputUrl.value.trim();
    if (!url) {
      inputUrl.focus();
      return;
    }

    const category = selectCategory.value || null;
    const isVideo = url.includes("youtube.com") || url.includes("youtu.be") || category === "Video";

    btnDownload.disabled = true;
    const origHtml = btnDownload.innerHTML;
    btnDownload.innerHTML = "<span>Adding...</span>";

    if (hasChrome) {
      chrome.runtime.sendMessage({
        type: "DISPATCH_DOWNLOAD",
        url: url,
        category: category,
        is_media: isVideo
      }, (resp) => {
        handleSuccess();
      });
    } else {
      try {
        await fetch("http://127.0.0.1:19532/api/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url, category: category, quality: "best", start_now: true })
        });
        handleSuccess();
      } catch (_) {
        btnDownload.disabled = false;
        btnDownload.innerHTML = origHtml;
      }
    }

    function handleSuccess() {
      btnDownload.disabled = false;
      btnDownload.innerHTML = "<span>✓ Added</span>";
      inputUrl.value = "";
      setTimeout(() => {
        btnDownload.innerHTML = origHtml;
      }, 1500);
      refreshStatus();
    }
  }

  btnDownload.addEventListener("click", triggerDownload);
  inputUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") triggerDownload();
  });

  // Open App
  btnOpenGui.addEventListener("click", () => {
    if (hasChrome) {
      chrome.runtime.sendMessage({ type: "OPEN_APP" });
    } else {
      fetch("http://127.0.0.1:19532/api/open_modal", { method: "POST", body: "{}" }).catch(() => {});
    }
  });

  // Polling Status & Metrics
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0.0 KB/s";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i] + "/s";
  }

  function updateUiWithStatus(resp) {
    if (!resp) return;
    if (resp.connected || resp.daemon_alive || resp.status === "ok") {
      statusPill.className = "status-pill status-online";
      statusText.textContent = "Engine Ready";
    } else {
      statusPill.className = "status-pill status-standby";
      statusText.textContent = "Standby";
    }

    if (resp.speed !== undefined) {
      metricSpeed.textContent = formatBytes(resp.speed);
    }
    if (resp.active !== undefined) {
      metricActive.textContent = `${resp.active} Active`;
    }
  }

  function refreshStatus() {
    if (hasChrome) {
      chrome.runtime.sendMessage({ type: "CHECK_STATUS" }, (resp) => {
        updateUiWithStatus(resp);
      });
    } else {
      fetch("http://127.0.0.1:19532/api/stats")
        .then((r) => r.json())
        .then(updateUiWithStatus)
        .catch(() => {
          updateUiWithStatus({ connected: false });
        });
    }
  }

  refreshStatus();
  const pollInterval = setInterval(refreshStatus, 2000);
  window.addEventListener("unload", () => clearInterval(pollInterval));
});
