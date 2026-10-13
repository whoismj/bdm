// Boring Download Manager (BDM) — High Performance Renderer Process

// State Management
const state = {
  tasks: new Map(),           // id -> task object
  selectedIds: new Set(),     // set of selected task IDs
  activeFilter: "all",        // "all", "downloading", "completed", "paused", or category name
  searchQuery: "",
  sortColumn: "created_at",
  sortAsc: false,
  statusModalTaskId: null,
  rowElements: new Map(),     // id -> tr element
  probeDebounceTimer: null,
  lastClipboardUrl: "",
  options: {
    connections: 8,
    clipboard: true,
    showProgress: true,
    notifications: true,
    minimizeTray: true
  }
};

// Utilities
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "0.0 KB/s";
  return formatBytes(bytesPerSec) + "/s";
}

function formatEta(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return "--:--:--";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(timestamp) {
  if (!timestamp) return "-";
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getStatusPill(status) {
  switch (status) {
    case "completed":
      return `<span class="status-pill status-completed"><span class="status-dot"></span>Completed</span>`;
    case "downloading":
      return `<span class="status-pill status-downloading"><span class="status-dot pulse"></span>Downloading</span>`;
    case "paused":
      return `<span class="status-pill status-paused"><span class="status-dot"></span>Paused</span>`;
    case "error":
      return `<span class="status-pill status-error"><span class="status-dot"></span>Error</span>`;
    default:
      return `<span class="status-pill status-queued"><span class="status-dot"></span>Queued</span>`;
  }
}

function getCategoryIcon(cat) {
  switch (cat) {
    case "Compressed":
      return `<span class="file-icon-badge cat-compressed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M12 4v18M3 10h18M3 16h18"/></svg></span>`;
    case "Video":
      return `<span class="file-icon-badge cat-video"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg></span>`;
    case "Music":
      return `<span class="file-icon-badge cat-music"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>`;
    case "Document":
      return `<span class="file-icon-badge cat-document"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>`;
    case "Program":
      return `<span class="file-icon-badge cat-program"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span>`;
    case "Image":
      return `<span class="file-icon-badge cat-image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span>`;
    default:
      return `<span class="file-icon-badge cat-other"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg></span>`;
  }
}

// DOM Elements
const tbody = document.getElementById("downloads-tbody");
const emptyState = document.getElementById("empty-state");
const checkAll = document.getElementById("check-all");
const searchInput = document.getElementById("search-input");
const btnSearchClear = document.getElementById("btn-search-clear");
const categoryList = document.getElementById("category-list");

// Modals
const modalAdd = document.getElementById("modal-add");
const modalStatus = document.getElementById("modal-status");
const modalComplete = document.getElementById("modal-complete");
const modalLimiter = document.getElementById("modal-limiter");
const modalOptions = document.getElementById("modal-options");
const contextMenu = document.getElementById("context-menu");
const clipboardToast = document.getElementById("clipboard-toast");

// Initialize & Theme Handling
async function initTheme() {
  try {
    const { colors, font } = await window.api.getTheme();
    applyTheme(colors, font);
  } catch (err) {
    console.error("Theme init error:", err);
  }

  window.api.onThemeChanged(({ colors, font }) => {
    applyTheme(colors, font);
  });
}

function applyTheme(colors, font) {
  const root = document.documentElement;
  if (!colors) return;
  if (colors.background) root.style.setProperty("--bg-surface", colors.background);
  if (colors.dark_background) root.style.setProperty("--bg-main", colors.dark_background);
  if (colors.lighter_background) root.style.setProperty("--bg-card", colors.lighter_background);
  if (colors.accent) root.style.setProperty("--accent", colors.accent);
  if (colors.foreground) root.style.setProperty("--fg-main", colors.foreground);
  if (colors.bright_foreground) root.style.setProperty("--fg-bright", colors.bright_foreground);
  if (colors.green) root.style.setProperty("--green", colors.green);
  if (colors.yellow) root.style.setProperty("--yellow", colors.yellow);
  if (colors.red) root.style.setProperty("--red", colors.red);
  if (colors.selection) root.style.setProperty("--border", colors.selection);
  
  // High-clarity modern sans-serif for UI, JetBrainsMono strictly for monospace metrics
  root.style.setProperty("--font-sans", "'Inter', 'Noto Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif");
  root.style.setProperty("--font-mono", `'${font || "JetBrainsMono Nerd Font"}', monospace`);
}

// Daemon Event Handlers
function initDaemonListener() {
  window.api.onDaemonEvent((msg) => {
    const event = msg.event;
    if (event === "init") {
      state.tasks.clear();
      state.rowElements.clear();
      tbody.innerHTML = "";
      if (Array.isArray(msg.tasks)) {
        for (const t of msg.tasks) {
          state.tasks.set(t.id, t);
        }
      }
      renderTable();
      updateBadges();
      updateStatusBar();
    } else if (event === "task_added") {
      const task = msg.task;
      state.tasks.set(task.id, task);
      renderTable();
      updateBadges();
      updateStatusBar();
      if (state.options.showProgress) {
        openStatusModal(task.id);
      }
    } else if (event === "open_add_modal") {
      openModal(modalAdd);
      if (msg.url) {
        document.getElementById("input-url").value = msg.url;
        probeUrl(msg.url);
      } else {
        document.getElementById("input-url").focus();
      }
    } else if (event === "open_options_modal") {
      document.getElementById("opt-connections").value = String(state.options.connections);
      document.getElementById("opt-clipboard").checked = state.options.clipboard;
      document.getElementById("opt-show-progress").checked = state.options.showProgress;
      document.getElementById("opt-notifications").checked = state.options.notifications;
      switchOptionsTab(msg.tab || "extensions");
      openModal(modalOptions);
    } else if (event === "tick") {
      if (Array.isArray(msg.tasks)) {
        for (const task of msg.tasks) {
          state.tasks.set(task.id, task);
          updateRowCells(task);
        }
      }
      updateBadges();
      updateStatusBar();
      if (state.statusModalTaskId) {
        const currentTask = state.tasks.get(state.statusModalTaskId);
        if (currentTask) {
          updateStatusModalContent(currentTask);
        }
      }
    } else if (event === "task_paused") {
      const t = state.tasks.get(msg.id);
      if (t) {
        t.status = "paused";
        t.speed = 0;
        updateRowCells(t);
        updateBadges();
        updateStatusBar();
      }
    } else if (event === "task_resumed") {
      const t = state.tasks.get(msg.id);
      if (t) {
        t.status = "downloading";
        updateRowCells(t);
        updateBadges();
        updateStatusBar();
      }
    } else if (event === "task_deleted") {
      state.tasks.delete(msg.id);
      state.selectedIds.delete(msg.id);
      const row = state.rowElements.get(msg.id);
      if (row) {
        row.remove();
        state.rowElements.delete(msg.id);
      }
      if (state.statusModalTaskId === msg.id) {
        closeModal(modalStatus);
      }
      updateBadges();
      updateStatusBar();
      checkEmptyState();
    } else if (event === "complete") {
      const task = msg.task;
      state.tasks.set(task.id, task);
      updateRowCells(task);
      updateBadges();
      updateStatusBar();
      if (state.options.notifications) {
        window.api.notify(
          "Download Finished",
          `${task.filename} (${formatBytes(task.total_size)}) downloaded successfully.`
        );
      }
      showCompleteDialog(task);
    } else if (event === "clipboard_url") {
      if (state.options.clipboard && msg.url && msg.url !== state.lastClipboardUrl) {
        state.lastClipboardUrl = msg.url;
        showClipboardToast(msg.url);
      }
    }
  });
}

// Table Rendering & Updates
function getFilteredTasks() {
  const tasks = Array.from(state.tasks.values());
  const filter = state.activeFilter;
  const query = state.searchQuery.toLowerCase();

  return tasks.filter((t) => {
    // Category / State filter
    if (filter === "all") {
      // pass
    } else if (filter === "downloading") {
      if (t.status !== "downloading") return false;
    } else if (filter === "completed") {
      if (t.status !== "completed") return false;
    } else if (filter === "paused") {
      if (t.status !== "paused" && t.status !== "queued") return false;
    } else {
      if (t.category !== filter) return false;
    }

    // Search query filter
    if (query) {
      const matchName = (t.filename || "").toLowerCase().includes(query);
      const matchUrl = (t.url || "").toLowerCase().includes(query);
      const matchCat = (t.category || "").toLowerCase().includes(query);
      if (!matchName && !matchUrl && !matchCat) return false;
    }

    return true;
  }).sort((a, b) => {
    let va = a[state.sortColumn];
    let vb = b[state.sortColumn];
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return state.sortAsc ? -1 : 1;
    if (va > vb) return state.sortAsc ? 1 : -1;
    return 0;
  });
}

function renderTable() {
  const filtered = getFilteredTasks();
  tbody.innerHTML = "";
  state.rowElements.clear();

  if (filtered.length === 0) {
    emptyState.style.display = "flex";
    return;
  }
  emptyState.style.display = "none";

  for (const task of filtered) {
    const tr = createRowElement(task);
    tbody.appendChild(tr);
    state.rowElements.set(task.id, tr);
  }
  updateCheckAllState();
}

function createRowElement(task) {
  const tr = document.createElement("tr");
  tr.id = `row-${task.id}`;
  if (state.selectedIds.has(task.id)) {
    tr.classList.add("selected");
  }

  const isDone = task.status === "completed";
  const effectiveDownloaded = (isDone && task.total_size > 0) ? task.total_size : task.downloaded_size;
  const pct = isDone ? "100.0" : (task.total_size > 0 ? Math.min(100, (effectiveDownloaded / task.total_size) * 100).toFixed(1) : "0.0");

  tr.innerHTML = `
    <td class="col-check"><input type="checkbox" class="row-checkbox" data-id="${task.id}" ${state.selectedIds.has(task.id) ? "checked" : ""}></td>
    <td class="col-name">
      <div class="file-cell">
        <span class="file-icon">${getCategoryIcon(task.category)}</span>
        <span class="file-title" title="${task.filename}">${task.filename}</span>
      </div>
    </td>
    <td class="col-size font-mono cell-size">${formatBytes(task.total_size)}</td>
    <td class="col-status cell-status">${getStatusPill(task.status)}</td>
    <td class="col-progress cell-progress">
      <div class="progress-cell-wrapper">
        <div class="mini-progress-bar">
          <div class="mini-progress-fill" style="width: ${pct}%"></div>
        </div>
        <div class="progress-text-row">
          <span class="pct-text">${pct}%</span>
          <span class="bytes-text">${formatBytes(task.downloaded_size)}</span>
        </div>
      </div>
    </td>
    <td class="col-speed font-mono cell-speed">${task.status === "downloading" ? formatSpeed(task.speed) : "-"}</td>
    <td class="col-eta font-mono cell-eta">${task.status === "downloading" ? formatEta(task.eta) : "-"}</td>
    <td class="col-category">${task.category}</td>
    <td class="col-date font-mono text-dim">${formatDate(task.created_at)}</td>
  `;

  // Row Click Selection
  tr.addEventListener("click", (e) => {
    if (e.target.classList.contains("row-checkbox")) return;
    if (e.ctrlKey || e.metaKey) {
      toggleRowSelection(task.id);
    } else if (e.shiftKey) {
      // Range selection
      selectRowRange(task.id);
    } else {
      selectSingleRow(task.id);
    }
  });

  // Double-Click Action
  tr.addEventListener("dblclick", () => {
    if (task.status === "completed") {
      window.api.openFile(task.save_path);
    } else {
      openStatusModal(task.id);
    }
  });

  // Context Menu
  tr.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!state.selectedIds.has(task.id)) {
      selectSingleRow(task.id);
    }
    showContextMenu(e.clientX, e.clientY);
  });

  // Checkbox Change
  const chk = tr.querySelector(".row-checkbox");
  chk.addEventListener("change", (e) => {
    e.stopPropagation();
    if (chk.checked) {
      state.selectedIds.add(task.id);
      tr.classList.add("selected");
    } else {
      state.selectedIds.delete(task.id);
      tr.classList.remove("selected");
    }
    updateCheckAllState();
  });

  return tr;
}

// Surgical cell update for smooth 120Hz/144Hz updates
function updateRowCells(task) {
  const tr = state.rowElements.get(task.id);
  if (!tr) return;

  const isDone = task.status === "completed";
  const effectiveDownloaded = (isDone && task.total_size > 0) ? task.total_size : task.downloaded_size;
  const pct = isDone ? "100.0" : (task.total_size > 0 ? Math.min(100, (effectiveDownloaded / task.total_size) * 100).toFixed(1) : "0.0");

  // Status cell
  const statusCell = tr.querySelector(".cell-status");
  if (statusCell) {
    statusCell.innerHTML = getStatusPill(task.status);
  }

  // Progress cell
  const fill = tr.querySelector(".mini-progress-fill");
  if (fill) fill.style.width = `${pct}%`;
  const pctText = tr.querySelector(".pct-text");
  if (pctText) pctText.textContent = `${pct}%`;
  const bytesText = tr.querySelector(".bytes-text");
  if (bytesText) bytesText.textContent = formatBytes(effectiveDownloaded);

  // Speed & ETA
  const speedCell = tr.querySelector(".cell-speed");
  if (speedCell) {
    speedCell.textContent = task.status === "downloading" ? formatSpeed(task.speed) : "-";
  }
  const etaCell = tr.querySelector(".cell-eta");
  if (etaCell) {
    etaCell.textContent = task.status === "downloading" ? formatEta(task.eta) : "-";
  }
}

function checkEmptyState() {
  const filtered = getFilteredTasks();
  emptyState.style.display = filtered.length === 0 ? "flex" : "none";
}

// Selection Helpers
function selectSingleRow(id) {
  state.selectedIds.clear();
  state.selectedIds.add(id);
  updateRowSelectionClasses();
  updateCheckAllState();
}

function toggleRowSelection(id) {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
  } else {
    state.selectedIds.add(id);
  }
  updateRowSelectionClasses();
  updateCheckAllState();
}

function selectRowRange(targetId) {
  const filtered = getFilteredTasks();
  const ids = filtered.map(t => t.id);
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex === -1) return;

  const firstSelectedId = Array.from(state.selectedIds)[0];
  const firstIndex = ids.indexOf(firstSelectedId);
  const start = Math.min(firstIndex !== -1 ? firstIndex : 0, targetIndex);
  const end = Math.max(firstIndex !== -1 ? firstIndex : 0, targetIndex);

  state.selectedIds.clear();
  for (let i = start; i <= end; i++) {
    state.selectedIds.add(ids[i]);
  }
  updateRowSelectionClasses();
  updateCheckAllState();
}

function updateRowSelectionClasses() {
  for (const [id, tr] of state.rowElements.entries()) {
    const isSelected = state.selectedIds.has(id);
    tr.classList.toggle("selected", isSelected);
    const chk = tr.querySelector(".row-checkbox");
    if (chk) chk.checked = isSelected;
  }

  const selectionBar = document.getElementById("selection-bar");
  const selectionCount = document.getElementById("selection-count");
  if (selectionBar) {
    if (state.selectedIds.size > 0) {
      selectionBar.style.display = "flex";
      if (selectionCount) {
        selectionCount.textContent = `${state.selectedIds.size} ${state.selectedIds.size === 1 ? "download" : "downloads"} selected`;
      }
    } else {
      selectionBar.style.display = "none";
    }
  }
}

function updateCheckAllState() {
  const filtered = getFilteredTasks();
  if (filtered.length === 0) {
    checkAll.checked = false;
    checkAll.indeterminate = false;
  } else if (state.selectedIds.size === filtered.length) {
    checkAll.checked = true;
    checkAll.indeterminate = false;
  } else if (state.selectedIds.size > 0) {
    checkAll.checked = false;
    checkAll.indeterminate = true;
  } else {
    checkAll.checked = false;
    checkAll.indeterminate = false;
  }
}

// Badges & Status Bar
function updateBadges() {
  const tasks = Array.from(state.tasks.values());
  const counts = {
    all: tasks.length,
    downloading: 0,
    completed: 0,
    paused: 0,
    Compressed: 0,
    Video: 0,
    Music: 0,
    Document: 0,
    Program: 0,
    Image: 0,
    Other: 0
  };

  for (const t of tasks) {
    if (t.status === "downloading") counts.downloading++;
    else if (t.status === "completed") counts.completed++;
    else if (t.status === "paused" || t.status === "queued") counts.paused++;

    if (counts[t.category] !== undefined) counts[t.category]++;
    else counts.Other++;
  }

  const setBadge = (id, count) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = count;
    el.style.display = count > 0 ? "inline-block" : "none";
  };

  setBadge("count-all", counts.all);
  setBadge("count-downloading", counts.downloading);
  setBadge("count-completed", counts.completed);
  setBadge("count-paused", counts.paused);

  setBadge("count-compressed", counts.Compressed);
  setBadge("count-video", counts.Video);
  setBadge("count-music", counts.Music);
  setBadge("count-document", counts.Document);
  setBadge("count-program", counts.Program);
  setBadge("count-image", counts.Image);
  setBadge("count-other", counts.Other);
}

function updateStatusBar() {
  const tasks = Array.from(state.tasks.values());
  let totalSpeed = 0;
  let activeCount = 0;
  let completedCount = 0;

  for (const t of tasks) {
    if (t.status === "downloading") {
      totalSpeed += (t.speed || 0);
      activeCount++;
    } else if (t.status === "completed") {
      completedCount++;
    }
  }

  // Header status indicator
  const dot = document.querySelector("#header-engine-status .indicator-dot");
  const headerStatusText = document.getElementById("header-status-text");
  const headerSpeed = document.getElementById("header-global-speed");

  if (dot) {
    dot.className = activeCount > 0 ? "indicator-dot dot-active" : "indicator-dot dot-idle";
  }
  if (headerStatusText) {
    headerStatusText.textContent = activeCount > 0 ? `Downloading (${activeCount} active)` : "Engine Ready";
  }
  if (headerSpeed) {
    headerSpeed.textContent = formatSpeed(totalSpeed);
  }

  // Bottom status bar
  const statusSpeed = document.getElementById("status-speed-text");
  if (statusSpeed) statusSpeed.textContent = formatSpeed(totalSpeed);

  const statusTasks = document.getElementById("status-tasks-text");
  if (statusTasks) {
    statusTasks.textContent = `${tasks.length} Downloads (${activeCount} Active, ${completedCount} Completed)`;
  }
}

// THE ICONIC IDM DOWNLOAD STATUS MODAL (MULTI-SEGMENT VISUALIZER)
function openStatusModal(taskId) {
  const task = state.tasks.get(taskId);
  if (!task) return;

  state.statusModalTaskId = taskId;
  updateStatusModalContent(task);
  openModal(modalStatus);
}

function updateStatusModalContent(task) {
  const titleEl = document.getElementById("status-modal-title");
  if (titleEl) titleEl.textContent = task.filename || "Download Progress";
  
  const urlEl = document.getElementById("status-modal-url");
  if (urlEl) urlEl.textContent = task.url || "-";

  const statusEl = document.getElementById("detail-status") || document.getElementById("metric-status");
  if (statusEl) {
    statusEl.innerHTML = getStatusPill(task.status);
  }

  const isDone = task.status === "completed";
  const effectiveDownloaded = (isDone && task.total_size > 0) ? task.total_size : task.downloaded_size;
  const pct = isDone ? "100.0" : (task.total_size > 0 ? Math.min(100, (effectiveDownloaded / task.total_size) * 100).toFixed(1) : "0.0");

  const sizeEl = document.getElementById("detail-size") || document.getElementById("metric-total-size");
  if (sizeEl) sizeEl.textContent = formatBytes(task.total_size);

  const dlEl = document.getElementById("detail-downloaded") || document.getElementById("metric-downloaded");
  if (dlEl) dlEl.textContent = `${formatBytes(effectiveDownloaded)} (${pct}%)`;

  const speedEl = document.getElementById("detail-speed") || document.getElementById("metric-speed");
  if (speedEl) speedEl.textContent = task.status === "downloading" ? formatSpeed(task.speed) : "-";

  const etaEl = document.getElementById("detail-eta") || document.getElementById("metric-eta");
  if (etaEl) etaEl.textContent = task.status === "downloading" ? formatEta(task.eta) : "--:--:--";

  const savePathEl = document.getElementById("detail-save-path");
  if (savePathEl) savePathEl.textContent = task.save_path || "-";

  const resumableEl = document.getElementById("detail-resumable") || document.getElementById("metric-resume");
  if (resumableEl) {
    resumableEl.textContent = task.supports_ranges ? "Yes (Multi-Stream Range 206)" : "Single Stream";
  }

  // Master Overall Progress Bar
  const fillEl = document.getElementById("detail-progress-fill") || document.getElementById("master-progress-fill");
  if (fillEl) fillEl.style.width = `${pct}%`;

  const pctLargeEl = document.getElementById("detail-pct-large") || document.getElementById("master-progress-pct");
  if (pctLargeEl) pctLargeEl.textContent = `${pct}%`;

  // Pause / Resume Toggle Button
  const btnToggle = document.getElementById("btn-status-toggle-pause");
  if (btnToggle) {
    if (task.status === "downloading") {
      btnToggle.textContent = "Pause Transfer";
      btnToggle.className = "btn-warning";
    } else {
      btnToggle.textContent = "Resume Transfer";
      btnToggle.className = "btn-primary";
    }
  }

  // Update Dynamic Segment Cards in Grid
  const segments = task.segments || [];
  const segCountEl = document.getElementById("detail-segment-count") || document.getElementById("segments-count-label");
  if (segCountEl) segCountEl.textContent = segments.length || task.num_connections || 8;

  const segmentsGrid = document.getElementById("segments-grid") || document.getElementById("segment-blocks-track");
  if (segmentsGrid) {
    const totalSegments = Math.max(segments.length, task.num_connections || 8);
    if (segmentsGrid.children.length !== totalSegments) {
      segmentsGrid.innerHTML = "";
      for (let i = 0; i < totalSegments; i++) {
        const card = document.createElement("div");
        card.className = "segment-card";
        card.id = `seg-card-${i}`;
        card.innerHTML = `
          <div class="segment-label">
            <span class="font-mono">Stream #${i + 1}</span>
            <span class="segment-pct font-mono" id="seg-pct-${i}">0%</span>
          </div>
          <div class="segment-bar">
            <div class="segment-fill" id="seg-fill-${i}" style="width: 0%;"></div>
          </div>
        `;
        segmentsGrid.appendChild(card);
      }
    }

    for (let i = 0; i < totalSegments; i++) {
      const seg = segments[i];
      const fill = document.getElementById(`seg-fill-${i}`);
      const pctLabel = document.getElementById(`seg-pct-${i}`);
      if (seg) {
        const segPct = Math.min(100, (seg.progress * 100)).toFixed(1);
        if (fill) fill.style.width = `${segPct}%`;
        if (pctLabel) pctLabel.textContent = `${segPct}%`;
      } else if (isDone) {
        if (fill) fill.style.width = `100%`;
        if (pctLabel) pctLabel.textContent = `100%`;
      }
    }
  }
}

// URL Probing (Add Modal)
function probeUrl(url) {
  if (!url || !url.startsWith("http")) return;

  const probeCard = document.getElementById("probe-card");
  const probeLoading = document.getElementById("probe-loading");
  const probeDetails = document.getElementById("probe-details");
  const probeMediaRow = document.getElementById("probe-media-row");

  probeCard.style.display = "block";
  probeLoading.style.display = "flex";
  probeDetails.style.display = "none";

  window.api.sendCmd("probe", { url })
    .then((res) => {
      const data = res.data;
      if (!data) return;

      probeLoading.style.display = "none";
      probeDetails.style.display = "flex";

      document.getElementById("probe-filename").textContent = data.filename || "download.bin";
      document.getElementById("probe-size").textContent = data.total_size > 0 ? formatBytes(data.total_size) : "Unknown (Chunked Stream)";

      const rangesBadge = document.getElementById("probe-ranges");
      if (data.supports_ranges) {
        rangesBadge.className = "probe-badge badge-green";
        rangesBadge.textContent = "HTTP Range Resumable (Multi-segment)";
      } else {
        rangesBadge.className = "probe-badge badge-yellow";
        rangesBadge.textContent = "Single Connection (No Range Support)";
      }

      const qualityGroup = document.getElementById("media-quality-group");
      const qualitySelect = document.getElementById("select-quality");

      if (data.is_media) {
        probeMediaRow.style.display = "flex";
        if (qualityGroup) qualityGroup.style.display = "flex";

        if (qualitySelect && Array.isArray(data.qualities) && data.qualities.length > 0) {
          qualitySelect.innerHTML = "";
          for (const q of data.qualities) {
            const opt = document.createElement("option");
            opt.value = q.value;
            opt.textContent = q.label;
            if (q.value === "1080" || q.value === "best") {
              opt.selected = true;
            }
            qualitySelect.appendChild(opt);
          }
        }

        // Force clean .mp4 extension for YouTube / video downloads
        const rawTitle = data.media_title || data.filename.replace(/\.[^/.]+$/, "");
        const cleanTitle = rawTitle.replace(/[\\/*?:"<>|]/g, "_").trim();
        document.getElementById("input-filename").value = `${cleanTitle}.mp4`;
      } else {
        probeMediaRow.style.display = "none";
        if (qualityGroup) qualityGroup.style.display = "none";
        document.getElementById("input-filename").value = data.filename || "";
      }

      document.getElementById("select-category").value = data.category || (data.is_media ? "Video" : "Other");
      document.getElementById("input-savedir").value = data.save_dir || "";
    })
    .catch((err) => {
      probeLoading.innerHTML = `<span class="text-red">Failed to inspect URL: ${err.message}</span>`;
    });
}

// Modal Helpers
function openModal(modal) {
  modal.style.display = "flex";
}

function closeModal(modal) {
  modal.style.display = "none";
  if (modal === modalStatus) {
    state.statusModalTaskId = null;
  }
}

// Download Complete Dialog
function showCompleteDialog(task) {
  if (state.statusModalTaskId === task.id) {
    closeModal(modalStatus);
  }
  document.getElementById("complete-filename").textContent = task.filename;
  document.getElementById("complete-size").textContent = formatBytes(task.total_size);
  document.getElementById("complete-path").textContent = task.save_path;

  document.getElementById("btn-complete-open-file").onclick = () => {
    window.api.openFile(task.save_path);
    closeModal(modalComplete);
  };
  document.getElementById("btn-complete-open-folder").onclick = () => {
    window.api.openFolder(task.save_path);
    closeModal(modalComplete);
  };

  openModal(modalComplete);
}

// Clipboard Toast
function showClipboardToast(url) {
  document.getElementById("toast-url").textContent = url;
  clipboardToast.style.display = "flex";

  document.getElementById("toast-btn-download").onclick = () => {
    clipboardToast.style.display = "none";
    document.getElementById("input-url").value = url;
    openModal(modalAdd);
    probeUrl(url);
  };

  document.getElementById("toast-btn-dismiss").onclick = () => {
    clipboardToast.style.display = "none";
  };
}

// Context Menu Helpers
function showContextMenu(x, y) {
  contextMenu.style.left = `${Math.min(window.innerWidth - 220, x)}px`;
  contextMenu.style.top = `${Math.min(window.innerHeight - 260, y)}px`;
  contextMenu.style.display = "block";
}

function hideContextMenu() {
  contextMenu.style.display = "none";
}

// Event Listeners Setup
function setupEventListeners() {
  // Global Click to close context menu
  window.addEventListener("click", () => hideContextMenu());

  // Search Box
  searchInput.addEventListener("input", () => {
    state.searchQuery = searchInput.value.trim();
    renderTable();
  });
  btnSearchClear.addEventListener("click", () => {
    searchInput.value = "";
    state.searchQuery = "";
    renderTable();
  });

  // Category Filter
  categoryList.addEventListener("click", (e) => {
    const item = e.target.closest(".category-item");
    if (!item) return;

    categoryList.querySelectorAll(".category-item").forEach(el => el.classList.remove("active"));
    item.classList.add("active");

    state.activeFilter = item.getAttribute("data-filter");
    renderTable();
  });

  // Table Header Sorting
  document.querySelectorAll(".idm-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort");
      if (state.sortColumn === col) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortColumn = col;
        state.sortAsc = true;
      }
      renderTable();
    });
  });

  // Check All Checkbox
  checkAll.addEventListener("change", () => {
    const filtered = getFilteredTasks();
    if (checkAll.checked) {
      for (const t of filtered) state.selectedIds.add(t.id);
    } else {
      state.selectedIds.clear();
    }
    updateRowSelectionClasses();
  });

  // Toolbar: Add URL
  const btnAddUrl = document.getElementById("btn-add-url");
  btnAddUrl.addEventListener("click", async () => {
    // Check clipboard for initial URL
    const clip = await window.api.getClipboard();
    if (clip && clip.text && clip.text.startsWith("http")) {
      document.getElementById("input-url").value = clip.text;
      probeUrl(clip.text);
    } else {
      document.getElementById("input-url").value = "";
      document.getElementById("probe-card").style.display = "none";
    }
    openModal(modalAdd);
    document.getElementById("input-url").focus();
  });

  document.getElementById("empty-btn-add").addEventListener("click", () => {
    btnAddUrl.click();
  });

  // URL Input Typing / Pasting
  const inputUrl = document.getElementById("input-url");
  inputUrl.addEventListener("input", () => {
    clearTimeout(state.probeDebounceTimer);
    state.probeDebounceTimer = setTimeout(() => {
      probeUrl(inputUrl.value.trim());
    }, 400);
  });

  document.getElementById("btn-paste-url").addEventListener("click", async () => {
    const clip = await window.api.getClipboard();
    if (clip && clip.text) {
      inputUrl.value = clip.text.trim();
      probeUrl(inputUrl.value);
    }
  });

  document.getElementById("btn-browse-folder").addEventListener("click", async () => {
    const current = document.getElementById("input-savedir").value;
    const res = await window.api.chooseDirectory(current);
    if (res && res.success) {
      document.getElementById("input-savedir").value = res.path;
    }
  });

  // Quality change handler
  const qualitySelect = document.getElementById("select-quality");
  if (qualitySelect) {
    qualitySelect.addEventListener("change", () => {
      const fnInput = document.getElementById("input-filename");
      let currentFn = fnInput.value.trim();
      let base = currentFn.replace(/\.[^/.]+$/, "");
      if (qualitySelect.value === "audio") {
        fnInput.value = `${base}.m4a`;
        document.getElementById("select-category").value = "Music";
      } else {
        fnInput.value = `${base}.mp4`;
        document.getElementById("select-category").value = "Video";
      }
    });
  }

  // Add Modal Submit
  document.getElementById("btn-submit-add").addEventListener("click", () => {
    const url = inputUrl.value.trim();
    if (!url) return;

    const filename = document.getElementById("input-filename").value.trim();
    const category = document.getElementById("select-category").value;
    const save_dir = document.getElementById("input-savedir").value.trim();
    const connections = parseInt(document.getElementById("select-connections").value, 10) || 8;
    const quality = qualitySelect ? qualitySelect.value : "best";
    const start_now = document.getElementById("check-start-now").checked;

    window.api.sendCmd("add", {
      url,
      filename,
      category,
      save_path: save_dir ? `${save_dir}/${filename}` : undefined,
      connections,
      quality,
      start_now
    }).then(() => {
      closeModal(modalAdd);
    }).catch(err => {
      alert("Failed to add download: " + err.message);
    });
  });

  // Add Modal Close / Cancel
  document.getElementById("modal-add-close").onclick = () => closeModal(modalAdd);
  document.getElementById("btn-cancel-add").onclick = () => closeModal(modalAdd);

  // Status Modal Controls
  document.getElementById("modal-status-close").onclick = () => closeModal(modalStatus);
  document.getElementById("btn-status-hide").onclick = () => closeModal(modalStatus);
  document.getElementById("btn-status-toggle-pause").onclick = () => {
    if (!state.statusModalTaskId) return;
    const task = state.tasks.get(state.statusModalTaskId);
    if (!task) return;
    if (task.status === "downloading") {
      window.api.sendCmd("pause", { id: task.id });
    } else {
      window.api.sendCmd("resume", { id: task.id });
    }
  };
  document.getElementById("btn-status-cancel").onclick = () => {
    if (!state.statusModalTaskId) return;
    const task = state.tasks.get(state.statusModalTaskId);
    if (!task) return;
    window.api.sendCmd("delete", { id: task.id, delete_file: false });
    closeModal(modalStatus);
  };

  // Toolbar: Resume
  document.getElementById("btn-resume").addEventListener("click", () => {
    for (const id of state.selectedIds) {
      window.api.sendCmd("resume", { id });
    }
  });

  // Toolbar: Pause
  document.getElementById("btn-pause").addEventListener("click", () => {
    for (const id of state.selectedIds) {
      window.api.sendCmd("pause", { id });
    }
  });

  // Toolbar: Stop All
  document.getElementById("btn-stop-all").addEventListener("click", () => {
    window.api.sendCmd("stop_all");
  });

  // Toolbar: Resume All
  document.getElementById("btn-resume-all").addEventListener("click", () => {
    window.api.sendCmd("resume_all");
  });

  // Toolbar: Delete
  document.getElementById("btn-delete").addEventListener("click", () => {
    if (state.selectedIds.size === 0) return;
    if (confirm(`Remove ${state.selectedIds.size} download(s) from the list?`)) {
      for (const id of state.selectedIds) {
        window.api.sendCmd("delete", { id, delete_file: false });
      }
    }
  });

  const btnDeselectAll = document.getElementById("btn-deselect-all");
  if (btnDeselectAll) {
    btnDeselectAll.addEventListener("click", () => {
      state.selectedIds.clear();
      updateRowSelectionClasses();
      updateCheckAllState();
    });
  }

  // Toolbar: Clean Done
  document.getElementById("btn-clean-done").addEventListener("click", () => {
    window.api.sendCmd("delete_completed");
  });

  // Speed Limiter Modal
  document.getElementById("btn-speed-limiter").addEventListener("click", () => {
    openModal(modalLimiter);
  });
  document.getElementById("status-chip-limiter").addEventListener("click", () => {
    openModal(modalLimiter);
  });
  document.getElementById("modal-limiter-close").onclick = () => closeModal(modalLimiter);
  document.getElementById("btn-limiter-cancel").onclick = () => closeModal(modalLimiter);

  // Preset limiter buttons
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kb = btn.getAttribute("data-kb");
      const inp = document.getElementById("input-limit-kb");
      if (inp) inp.value = kb;
      const chk = document.getElementById("check-enable-limit") || document.getElementById("check-limiter-enable");
      if (chk) chk.checked = true;
    });
  });

  document.getElementById("btn-limiter-save").addEventListener("click", () => {
    const chk = document.getElementById("check-enable-limit") || document.getElementById("check-limiter-enable");
    const enabled = chk ? chk.checked : false;
    const inp = document.getElementById("input-limit-kb");
    const kb = inp ? (parseInt(inp.value, 10) || 1024) : 1024;
    const limitBytes = enabled ? kb * 1024 : 0;

    window.api.sendCmd("speed_limit", { limit: limitBytes });

    const lbl = document.getElementById("btn-limiter-label");
    if (lbl) lbl.textContent = enabled ? `Limit: ${kb}KB/s` : "Speed Limit";
    const statusLimiter = document.getElementById("status-limiter-text");
    if (statusLimiter) statusLimiter.textContent = enabled ? `Speed Limit: ${kb} KB/s` : "Speed Limit: OFF";
    closeModal(modalLimiter);
  });

  // Options Modal & Tabs
  const tabBtnGeneral = document.getElementById("tab-btn-general");
  const tabBtnExtensions = document.getElementById("tab-btn-extensions");
  const tabPaneGeneral = document.getElementById("opt-tab-general");
  const tabPaneExtensions = document.getElementById("opt-tab-extensions");
  const browserListEl = document.getElementById("browser-list");

  function switchOptionsTab(target) {
    if (target === "extensions") {
      tabBtnExtensions.classList.add("active");
      tabBtnGeneral.classList.remove("active");
      tabPaneExtensions.style.display = "flex";
      tabPaneGeneral.style.display = "none";
      loadBrowserIntegrationStatus();
    } else {
      tabBtnGeneral.classList.add("active");
      tabBtnExtensions.classList.remove("active");
      tabPaneGeneral.style.display = "flex";
      tabPaneExtensions.style.display = "none";
    }
  }

  if (tabBtnGeneral) tabBtnGeneral.onclick = () => switchOptionsTab("general");
  if (tabBtnExtensions) tabBtnExtensions.onclick = () => switchOptionsTab("extensions");

  async function loadBrowserIntegrationStatus() {
    if (!browserListEl) return;
    browserListEl.innerHTML = '<div class="browser-loading-skeleton">Scanning system for installed browsers...</div>';
    try {
      const data = await window.api.getBrowserStatus();
      if (!data || data.error) {
        browserListEl.innerHTML = `<div class="browser-loading-skeleton text-danger">Failed to scan: ${data?.error || "Unknown error"}</div>`;
        return;
      }

      const browserIcons = {
        zen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
        firefox: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M12 3a17 17 0 0 0 0 18"/></svg>`,
        chrome: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M21.17 8H12"/><path d="M3.95 6.06L8.45 13.85"/><path d="M10.88 21.94L15.38 14.15"/></svg>`,
        chromium: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="4.2" y1="16.5" x2="9.4" y2="13.5"/><line x1="19.8" y1="16.5" x2="14.6" y2="13.5"/></svg>`,
        brave: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l7 4v6c0 5.5-3.5 10-7 11-3.5-1-7-5.5-7-11V6l7-4z"/></svg>`,
        librewolf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
      };

      let html = "";
      for (const [key, b] of Object.entries(data)) {
        const isReady = b.status === "ready";
        const isHostOnly = b.status === "host_only";
        const isNotInstalled = b.status === "not_installed";

        let badgeClass = "badge-muted";
        let badgeText = "Not Detected";
        if (isReady) {
          badgeClass = "badge-ready";
          badgeText = "Ready & Active";
        } else if (isHostOnly) {
          badgeClass = "badge-warning";
          badgeText = "Host Ready";
        } else if (!isNotInstalled) {
          badgeClass = "badge-warning";
          badgeText = "Needs Setup";
        }

        const icon = browserIcons[key] || browserIcons.chromium;

        html += `
          <div class="browser-card" data-browser="${key}">
            <div class="browser-card-left">
              <div class="browser-icon-badge">${icon}</div>
              <div class="browser-meta">
                <div class="browser-name-row">
                  <span class="browser-title">${b.name}</span>
                  <span class="browser-badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="browser-details" title="${b.details || ''}">${b.details || (isNotInstalled ? 'Not installed on system' : 'Ready to configure')}</div>
              </div>
            </div>
            <div class="browser-card-actions">
              ${!isNotInstalled ? `
                <button class="btn-secondary btn-xs btn-install-single" data-browser="${key}" title="Install / Sync extension with ${b.name}">
                  ${isReady ? 'Re-Sync' : 'Install'}
                </button>
              ` : `
                <button class="btn-secondary btn-xs" disabled style="opacity:0.4;">Unavailable</button>
              `}
            </div>
          </div>
        `;
      }

      browserListEl.innerHTML = html;

      // Attach single install handlers
      browserListEl.querySelectorAll(".btn-install-single").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          const bKey = e.currentTarget.getAttribute("data-browser");
          const originalText = e.currentTarget.textContent;
          e.currentTarget.textContent = "...";
          e.currentTarget.disabled = true;
          try {
            const res = await window.api.installBrowserExtension(bKey);
            if (res && res.success) {
              window.api.notify("BDM Extension Configured", `Successfully integrated with ${bKey}!`);
            }
          } catch (err) {
            console.error("Install error:", err);
          }
          await loadBrowserIntegrationStatus();
        });
      });

    } catch (err) {
      browserListEl.innerHTML = `<div class="browser-loading-skeleton text-danger">Error: ${err.message}</div>`;
    }
  }

  // Master Install All Button
  const btnInstallAll = document.getElementById("btn-install-all-browsers");
  if (btnInstallAll) {
    btnInstallAll.addEventListener("click", async () => {
      const originalText = btnInstallAll.innerHTML;
      btnInstallAll.innerHTML = "Configuring...";
      btnInstallAll.disabled = true;
      try {
        const res = await window.api.installBrowserExtension("all");
        window.api.notify("BDM Browser Integration", "Successfully configured extensions for all installed browsers!");
      } catch (err) {
        console.error("Install all error:", err);
      } finally {
        btnInstallAll.innerHTML = originalText;
        btnInstallAll.disabled = false;
        await loadBrowserIntegrationStatus();
      }
    });
  }

  // Copy Extension Path Button
  const btnCopyExtPath = document.getElementById("btn-copy-ext-path");
  if (btnCopyExtPath) {
    btnCopyExtPath.addEventListener("click", () => {
      const pathText = document.getElementById("ext-path-text").textContent.trim();
      window.api.copyToClipboard(pathText);
      const prev = btnCopyExtPath.textContent;
      btnCopyExtPath.textContent = "Copied!";
      setTimeout(() => { btnCopyExtPath.textContent = prev; }, 1500);
    });
  }

  // Open Extension Folder Button
  const btnOpenExtDir = document.getElementById("btn-open-ext-dir");
  if (btnOpenExtDir) {
    btnOpenExtDir.addEventListener("click", () => {
      const pathText = document.getElementById("ext-path-text").textContent.trim();
      window.api.openFolder(pathText);
    });
  }

  document.getElementById("btn-options").addEventListener("click", () => {
    document.getElementById("opt-connections").value = String(state.options.connections);
    document.getElementById("opt-clipboard").checked = state.options.clipboard;
    document.getElementById("opt-show-progress").checked = state.options.showProgress;
    document.getElementById("opt-notifications").checked = state.options.notifications;
    const optTray = document.getElementById("opt-minimize-tray");
    if (optTray) optTray.checked = state.options.minimizeTray !== false;
    switchOptionsTab("general");
    openModal(modalOptions);
  });
  document.getElementById("modal-options-close").onclick = () => closeModal(modalOptions);
  document.getElementById("btn-options-cancel").onclick = () => closeModal(modalOptions);
  document.getElementById("btn-options-save").addEventListener("click", () => {
    state.options.connections = parseInt(document.getElementById("opt-connections").value, 10);
    state.options.clipboard = document.getElementById("opt-clipboard").checked;
    state.options.showProgress = document.getElementById("opt-show-progress").checked;
    state.options.notifications = document.getElementById("opt-notifications").checked;
    const optTray = document.getElementById("opt-minimize-tray");
    if (optTray) {
      state.options.minimizeTray = optTray.checked;
      window.api.setMinimizeToTray(state.options.minimizeTray);
    }

    window.api.sendCmd("set_clipboard_watch", { enabled: state.options.clipboard });
    document.getElementById("status-clipboard-text").textContent =
      state.options.clipboard ? "Clipboard Monitor: Active" : "Clipboard Monitor: OFF";

    closeModal(modalOptions);
  });

  // Complete Dialog Close
  document.getElementById("modal-complete-close").onclick = () => closeModal(modalComplete);
  document.getElementById("btn-complete-close").onclick = () => closeModal(modalComplete);

  // Context Menu Actions
  document.getElementById("ctx-open-file").addEventListener("click", () => {
    for (const id of state.selectedIds) {
      const task = state.tasks.get(id);
      if (task && task.save_path) window.api.openFile(task.save_path);
    }
  });

  document.getElementById("ctx-open-folder").addEventListener("click", () => {
    for (const id of state.selectedIds) {
      const task = state.tasks.get(id);
      if (task && task.save_path) window.api.openFolder(task.save_path);
    }
  });

  document.getElementById("ctx-resume").addEventListener("click", () => {
    for (const id of state.selectedIds) window.api.sendCmd("resume", { id });
  });

  document.getElementById("ctx-pause").addEventListener("click", () => {
    for (const id of state.selectedIds) window.api.sendCmd("pause", { id });
  });

  document.getElementById("ctx-details").addEventListener("click", () => {
    const id = Array.from(state.selectedIds)[0];
    if (id) openStatusModal(id);
  });

  document.getElementById("ctx-copy-link").addEventListener("click", () => {
    const id = Array.from(state.selectedIds)[0];
    const task = state.tasks.get(id);
    if (task && task.url) window.api.copyToClipboard(task.url);
  });

  document.getElementById("ctx-delete").addEventListener("click", () => {
    for (const id of state.selectedIds) {
      window.api.sendCmd("delete", { id, delete_file: false });
    }
  });

  document.getElementById("ctx-delete-file").addEventListener("click", () => {
    if (confirm("Delete file(s) permanently from disk?")) {
      for (const id of state.selectedIds) {
        window.api.sendCmd("delete", { id, delete_file: true });
      }
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener("keydown", (e) => {
    // If typing in input, don't trigger global hotkeys
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") {
      if (e.key === "Escape") {
        closeModal(modalAdd);
        closeModal(modalStatus);
        closeModal(modalComplete);
        closeModal(modalLimiter);
        closeModal(modalOptions);
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const filtered = getFilteredTasks();
      for (const t of filtered) {
        state.selectedIds.add(t.id);
      }
      updateRowSelectionClasses();
      updateCheckAllState();
      return;
    }

    if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const sInp = document.getElementById("search-input");
      if (sInp) sInp.focus();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "n" || e.key.toLowerCase() === "u")) {
      e.preventDefault();
      document.getElementById("btn-add-url").click();
      return;
    }

    if (e.key === "Escape") {
      if (state.selectedIds.size > 0) {
        state.selectedIds.clear();
        updateRowSelectionClasses();
        updateCheckAllState();
        return;
      }
      closeModal(modalAdd);
      closeModal(modalStatus);
      closeModal(modalComplete);
      closeModal(modalLimiter);
      closeModal(modalOptions);
      hideContextMenu();
    } else if (e.key === "Delete") {
      document.getElementById("btn-delete").click();
    } else if (e.key === " " && state.selectedIds.size > 0) {
      e.preventDefault();
      // Toggle pause/resume for selected
      const firstId = Array.from(state.selectedIds)[0];
      const task = state.tasks.get(firstId);
      if (task) {
        if (task.status === "downloading") {
          document.getElementById("btn-pause").click();
        } else {
          document.getElementById("btn-resume").click();
        }
      }
    } else if (e.key === "Enter") {
      const firstId = Array.from(state.selectedIds)[0];
      const task = state.tasks.get(firstId);
      if (task) {
        if (e.ctrlKey) {
          window.api.openFolder(task.save_path);
        } else if (task.status === "completed") {
          window.api.openFile(task.save_path);
        } else {
          openStatusModal(task.id);
        }
      }
    }
  });
}

// Load Initial Tasks from Daemon
async function loadInitialTasks() {
  try {
    const res = await window.api.sendCmd("list");
    if (res && Array.isArray(res.tasks)) {
      let changed = false;
      if (res.tasks.length !== state.tasks.size) {
        changed = true;
      } else {
        for (const t of res.tasks) {
          const old = state.tasks.get(t.id);
          if (!old || old.status !== t.status || old.total_size !== t.total_size) {
            changed = true;
            break;
          }
        }
      }
      for (const t of res.tasks) {
        state.tasks.set(t.id, t);
      }
      if (changed || state.rowElements.size === 0) {
        console.log(`[renderer] Rendering table with ${state.tasks.size} tasks (changed=${changed}, rowElements=${state.rowElements.size})`);
        renderTable();
      }
      updateBadges();
      updateStatusBar();
    } else {
      console.warn("[renderer] list returned invalid res:", res);
    }
  } catch (err) {
    console.error("Failed to load initial tasks:", err);
  }
}

// Start Application
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  setupEventListeners();
  initDaemonListener();
  renderTable();
  updateBadges();
  loadInitialTasks();
  setInterval(loadInitialTasks, 1500);
});
