// Boring Download Manager (BDM) — Media Grabber Content Script
// Detects media streams & video watch pages (e.g., YouTube) and provides a non-intrusive floating download action.

(function () {
  let activePill = null;
  let lastUrl = "";

  async function checkSettingsAndInit() {
    try {
      const settings = await chrome.storage.local.get({ captureVideo: true });
      if (!settings.captureVideo) return;
      handlePageChange();
    } catch (_) {}
  }

  function isVideoPage() {
    const loc = window.location.href;
    if (loc.includes("youtube.com/watch") || loc.includes("youtu.be/")) return true;
    if (loc.includes("vimeo.com/") && /\d+/.test(loc)) return true;
    if (document.querySelector("video[src], video source[src]")) return true;
    return false;
  }

  function getMediaTitle() {
    if (window.location.hostname.includes("youtube.com")) {
      const ytTitle = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, h1.title");
      if (ytTitle && ytTitle.textContent.trim()) {
        return ytTitle.textContent.trim();
      }
    }
    return document.title.replace(/ - YouTube$/, "").trim() || "video";
  }

  function handlePageChange() {
    const currentUrl = window.location.href;
    if (currentUrl === lastUrl && activePill) return;
    lastUrl = currentUrl;

    if (!isVideoPage()) {
      removePill();
      return;
    }

    // Delay slightly to let player / title render
    setTimeout(injectDownloadPill, 1200);
  }

  function removePill() {
    if (activePill && activePill.parentNode) {
      activePill.parentNode.removeChild(activePill);
    }
    activePill = null;
  }

  function injectDownloadPill() {
    if (document.getElementById("odm-floating-sniff-pill")) return;

    const pill = document.createElement("div");
    pill.id = "odm-floating-sniff-pill";
    pill.className = "odm-pill-container";

    pill.innerHTML = `
      <div class="odm-pill-inner">
        <div class="odm-pill-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v13M5 10l7 7 7-7"/>
            <path d="M4 19h16"/>
          </svg>
        </div>
        <div class="odm-pill-label">
          <span class="odm-pill-main">Download Video</span>
          <span class="odm-pill-sub">BDM 8-Stream Engine</span>
        </div>
        <button class="odm-pill-close" title="Dismiss">&times;</button>
      </div>
    `;

    document.body.appendChild(pill);
    activePill = pill;

    const inner = pill.querySelector(".odm-pill-inner");
    const closeBtn = pill.querySelector(".odm-pill-close");

    // Click handler for download action
    inner.addEventListener("click", (e) => {
      if (e.target.closest(".odm-pill-close")) return;

      const title = getMediaTitle();
      const filename = title ? `${title}.mp4` : null;

      // Visual feedback
      const labelMain = pill.querySelector(".odm-pill-main");
      if (labelMain) labelMain.textContent = "Opening BDM...";

      chrome.runtime.sendMessage({
        type: "DISPATCH_DOWNLOAD",
        url: window.location.href,
        filename: filename,
        category: "Video",
        is_media: true
      }, (resp) => {
        if (labelMain) {
          labelMain.textContent = "✓ Dispatched";
          setTimeout(removePill, 2000);
        }
      });
    });

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removePill();
    });
  }

  // YouTube SPA navigation listener
  window.addEventListener("yt-navigate-finish", handlePageChange);
  window.addEventListener("popstate", handlePageChange);

  // Fallback DOM observer for dynamic video elements
  let checkTimer = null;
  const observer = new MutationObserver(() => {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      if (!activePill && isVideoPage()) {
        injectDownloadPill();
      }
    }, 1500);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Init
  checkSettingsAndInit();
})();
