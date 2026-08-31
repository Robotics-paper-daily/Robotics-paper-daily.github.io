// Shell renderer (top frame). Owns the report iframe, the date picker, and the
// progress sidebar. It is the single subscriber to paperBridge.onProgress and
// relays each event into the sandboxed report through a narrow message channel
// so the originating card can reflect its own job.

const bridge = window.paperBridge;
const frame = document.getElementById("report-frame");
const select = document.getElementById("report-select");
const dateLabel = document.getElementById("date-label");
const datePrev = document.getElementById("date-prev");
const dateNext = document.getElementById("date-next");
const jobListEl = document.getElementById("job-list");
const jobEmptyEl = document.getElementById("job-empty");
const envBadge = document.getElementById("env-badge");
const zoteroSetupBtn = document.getElementById("zotero-setup-btn");

// jobId -> { el, data }
const rows = new Map();

// reports.json contents (newest-first); shared with the calendar popover.
let currentReports = [];

// Top-frame toast (refresh / search / Zotero feedback). The report iframe has its
// own showToast; this is the shell's equivalent.
function showShellToast(msg, kind = "info") {
  let tray = document.getElementById("shell-toast-tray");
  if (!tray) {
    tray = document.createElement("div");
    tray.id = "shell-toast-tray";
    document.body.appendChild(tray);
  }
  const t = document.createElement("div");
  t.className = `shell-toast ${kind}`;
  t.textContent = msg;
  tray.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ---- report navigation ----
async function fetchReports() {
  try {
    return await (await fetch("site/reports.json", { cache: "no-store" })).json();
  } catch (e) {
    console.error("[renderer] reports.json load failed:", e);
    return [];
  }
}
// (Re)build the hidden <select> index model. `keep` preserves the current date if
// it still exists, else falls back to newest (index 0).
function buildDateOptions(reports, keep) {
  select.innerHTML = "";
  reports.forEach((f) => {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f.replace(".html", "").replace(/_/g, "-");
    select.appendChild(o);
  });
  if (reports.length) select.value = keep && reports.includes(keep) ? keep : reports[0];
}
async function loadReports() {
  const reports = await fetchReports();
  currentReports = reports;
  buildDateOptions(reports);
  if (reports.length) setReport(select.value);
  updateDateUI();
}
// Manual refresh: re-pull reports.json (pick up newly published days), keep the
// current date, reload its report iframe to fetch the latest content live.
async function refreshAll() {
  const before = currentReports.length;
  const cur = select.value;
  const reports = await fetchReports();
  currentReports = reports;
  buildDateOptions(reports, cur);
  updateDateUI();
  renderCalendar();
  if (reports.length) {
    if (select.value !== cur) {
      setReport(select.value); // current date vanished → jump to nearest available
    } else {
      try {
        frame.contentWindow.location.reload();
      } catch {
        setReport(select.value);
      }
    }
  }
  const grew = reports.length - before;
  showShellToast(grew > 0 ? `发现 ${grew} 个新报告` : "已是最新", grew > 0 ? "success" : "info");
  refreshEnv();
}
function setReport(file) {
  resetReportRpcState();
  const zoteroEnabled = !!getZoteroSaver();
  frame.src = `site/daily_html/${file}?app=1&zotero=${zoteroEnabled ? "1" : "0"}`;
  document.title = `PaperReader · ${file.replace(".html", "").replace(/_/g, "-")}`;
}
// Reflect the current selection in the pill label, and enable/disable ‹ › at the
// ends. reports.json is newest-first (index 0 = newest), so ‹ goes older
// (index+1) and › goes newer (index-1).
function updateDateUI() {
  const opt = select.options[select.selectedIndex];
  if (dateLabel) dateLabel.textContent = opt ? opt.textContent : "—";
  if (datePrev) datePrev.disabled = select.selectedIndex >= select.options.length - 1;
  if (dateNext) dateNext.disabled = select.selectedIndex <= 0;
  // Keep the calendar in sync when it's open (e.g. day-arrow navigation).
  if (datePopover && datePopover.classList.contains("open")) {
    alignDpToSelection();
    renderCalendar();
  }
}
function selectReportByIndex(i) {
  const n = select.options.length;
  if (!n) return;
  select.selectedIndex = Math.max(0, Math.min(n - 1, i));
  setReport(select.value);
  updateDateUI();
  setActiveTab("home");
}
select.addEventListener("change", () => {
  setReport(select.value);
  updateDateUI();
  setActiveTab("home");
});
if (datePrev) datePrev.addEventListener("click", () => selectReportByIndex(select.selectedIndex + 1));
if (dateNext) dateNext.addEventListener("click", () => selectReportByIndex(select.selectedIndex - 1));
document.getElementById("btn-settings").addEventListener("click", () => bridge.openSettings());
if (zoteroSetupBtn) {
  zoteroSetupBtn.addEventListener("click", () => bridge.openSettings());
}

// ---- manual refresh ----
const btnRefresh = document.getElementById("btn-refresh");
let refreshing = false;
async function doRefresh() {
  if (refreshing) return;
  refreshing = true;
  btnRefresh.classList.add("spinning");
  btnRefresh.disabled = true;
  try {
    await refreshAll();
  } finally {
    refreshing = false;
    btnRefresh.classList.remove("spinning");
    btnRefresh.disabled = false;
  }
}
btnRefresh.addEventListener("click", doRefresh);

// ---- calendar popover (the merged 论文列表) ----
const datePillBtn = document.getElementById("date-pill-btn");
const datePopover = document.getElementById("date-popover");
const DP_DOW = ["日", "一", "二", "三", "四", "五", "六"];
const DP_MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
let dpYear = null;
let dpMonth0 = null; // the month currently shown in the popover

function selectedDateKey() {
  const m = (select.value || "").match(/^(\d{4})_(\d{2})_(\d{2})\.html$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function alignDpToSelection() {
  const key = selectedDateKey();
  if (key) {
    const [y, mo] = key.split("-");
    dpYear = +y;
    dpMonth0 = +mo - 1;
    return;
  }
  const latest = window.PRCalendar.latestReport(currentReports);
  const now = new Date();
  dpYear = latest ? latest.year : now.getFullYear();
  dpMonth0 = latest ? latest.month0 : now.getMonth();
}
function renderCalendar() {
  if (!datePopover || !datePopover.classList.contains("open")) return;
  if (dpYear == null) alignDpToSelection();
  const C = window.PRCalendar;
  const dateMap = C.reportDateMap(currentReports);
  const weeks = C.monthMatrix(dpYear, dpMonth0, dateMap);
  const selKey = selectedDateKey();
  const months = C.monthsWithReports(currentReports);
  const cur = dpYear * 12 + dpMonth0;
  const minIdx = months.length ? months[0].year * 12 + months[0].month0 : cur;
  const maxIdx = months.length ? months[months.length - 1].year * 12 + months[months.length - 1].month0 : cur;

  let html = '<div class="dp-head">';
  html += `<button class="dp-nav" id="dp-prev" type="button" ${cur > minIdx ? "" : "disabled"} aria-label="上个月"><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg></button>`;
  html += `<span class="dp-title">${dpYear} 年 ${DP_MONTHS[dpMonth0]}</span>`;
  html += `<button class="dp-nav" id="dp-next" type="button" ${cur < maxIdx ? "" : "disabled"} aria-label="下个月"><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg></button>`;
  html += '</div><div class="dp-grid">';
  for (const d of DP_DOW) html += `<div class="dp-dow">${d}</div>`;
  for (const week of weeks) {
    for (const cell of week) {
      const cls = ["dp-cell"];
      if (cell.inMonth) cls.push("in");
      if (cell.file) cls.push("has");
      if (cell.key === selKey) cls.push("sel");
      html += `<button class="${cls.join(" ")}" type="button" ${cell.file ? `data-file="${cell.file}"` : "disabled"}>${cell.day}</button>`;
    }
  }
  html += '</div><div class="dp-foot"><span class="dp-hint">紫色 = 有报告</span><button class="dp-latest" id="dp-latest" type="button">跳到最新</button></div>';
  datePopover.innerHTML = html;

  const prev = datePopover.querySelector("#dp-prev");
  const next = datePopover.querySelector("#dp-next");
  if (prev) prev.addEventListener("click", () => stepMonth(-1));
  if (next) next.addEventListener("click", () => stepMonth(1));
  const latestBtn = datePopover.querySelector("#dp-latest");
  if (latestBtn)
    latestBtn.addEventListener("click", () => {
      const latest = C.latestReport(currentReports);
      if (latest) pickDate(latest.file);
    });
  datePopover.querySelectorAll(".dp-cell[data-file]").forEach((b) => {
    b.addEventListener("click", () => pickDate(b.getAttribute("data-file")));
  });
}
function stepMonth(delta) {
  if (dpYear == null) alignDpToSelection();
  const idx = dpYear * 12 + dpMonth0 + delta;
  dpYear = Math.floor(idx / 12);
  dpMonth0 = ((idx % 12) + 12) % 12;
  renderCalendar();
}
function pickDate(file) {
  const i = [...select.options].findIndex((o) => o.value === file);
  if (i >= 0) select.selectedIndex = i;
  else select.value = file;
  setReport(select.value);
  updateDateUI();
  setActiveTab("home");
  closeCalendar();
}
function openCalendar() {
  if (!datePopover) return;
  alignDpToSelection();
  datePopover.classList.add("open");
  datePillBtn.setAttribute("aria-expanded", "true");
  renderCalendar();
}
function closeCalendar() {
  if (!datePopover) return;
  datePopover.classList.remove("open");
  datePillBtn.setAttribute("aria-expanded", "false");
}
datePillBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (datePopover.classList.contains("open")) closeCalendar();
  else openCalendar();
});
document.addEventListener("click", (e) => {
  if (
    datePopover.classList.contains("open") &&
    !datePopover.contains(e.target) &&
    !datePillBtn.contains(e.target)
  )
    closeCalendar();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCalendar();
});

// ---- in-app browser tabs: home = the report iframe; web pages open as tabs ----
const tabbarEl = document.getElementById("tabbar");
const tabHome = document.getElementById("tab-home");
const viewStack = document.getElementById("view-stack");
const navBar = document.getElementById("nav");
const navBack = document.getElementById("nav-back");
const navFwd = document.getElementById("nav-fwd");
const navReload = document.getElementById("nav-reload");
const navUrl = document.getElementById("nav-url");
const navExt = document.getElementById("nav-ext");

const TAB_ICON = {
  globe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>',
  spinner:
    '<svg class="tab-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.5"></path></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
};

const webTabs = new Map(); // id -> { id, url, webview, tabEl, titleEl, icoEl }
const MAX_WEB_TABS = 8;
let activeTabId = "home";
let tabSeq = 0;

// The report is a unique-origin sandbox. CSS keeps it mounted (but invisible)
// while a web tab is active, so its own scroll position remains intact without
// granting the shell DOM access.
let reportScrollY = 0;
function readReportScroll() {
  reportScrollY = 0;
}
function restoreReportScroll() {
  reportScrollY = 0;
}

function setActiveTab(id) {
  const leavingHome = activeTabId === "home" && id !== "home";
  const enteringHome = activeTabId !== "home" && id === "home";
  if (leavingHome) readReportScroll(); // snapshot before display:none tears it down
  activeTabId = id;
  frame.classList.toggle("view-hidden", id !== "home");
  tabHome.classList.toggle("active", id === "home");
  webTabs.forEach((t) => {
    const on = t.id === id;
    t.webview.classList.toggle("view-hidden", !on);
    t.tabEl.classList.toggle("active", on);
    if (on) t.tabEl.classList.remove("has-new");
  });
  const web = id !== "home" ? webTabs.get(id) : null;
  navBar.classList.toggle("view-hidden", !web);
  if (web) updateNav(web);
  if (enteringHome) restoreReportScroll(); // reapply once visible (self-schedules across frames)
}

function updateNav(t) {
  let url = t.url;
  try { url = t.webview.getURL() || t.url; } catch {}
  navUrl.textContent = url;
  try {
    navBack.disabled = !t.webview.canGoBack();
    navFwd.disabled = !t.webview.canGoForward();
  } catch {
    navBack.disabled = true;
    navFwd.disabled = true;
  }
}

function openTab(url, opts = {}) {
  if (!/^https?:\/\//i.test(url || "")) return;
  for (const t of webTabs.values()) {
    if (t.url === url) { setActiveTab(t.id); return; } // dedup: focus existing
  }
  if (webTabs.size >= MAX_WEB_TABS) {
    showShellToast(`最多同时打开 ${MAX_WEB_TABS} 个网页标签`, "info");
    return;
  }
  const id = "tab" + ++tabSeq;
  const webview = document.createElement("webview");
  webview.setAttribute("src", url);
  webview.setAttribute("allowpopups", ""); // let in-page window.open reach the main-process handler → new tab
  webview.classList.add("view-hidden");
  viewStack.appendChild(webview);

  const tabEl = document.createElement("div");
  tabEl.className = "tab";
  tabEl.innerHTML =
    '<span class="tab-ico">' + TAB_ICON.spinner + "</span>" +
    '<span class="tab-title">加载中…</span>' +
    '<span class="tab-dot"></span>' +
    '<button class="tab-close" type="button" title="关闭" aria-label="关闭">' + TAB_ICON.close + "</button>";
  tabbarEl.appendChild(tabEl);

  const t = {
    id, url, webview, tabEl,
    titleEl: tabEl.querySelector(".tab-title"),
    icoEl: tabEl.querySelector(".tab-ico"),
  };
  webTabs.set(id, t);

  tabEl.addEventListener("click", (e) => { if (!e.target.closest(".tab-close")) setActiveTab(id); });
  tabEl.querySelector(".tab-close").addEventListener("click", (e) => { e.stopPropagation(); closeTab(id); });

  webview.addEventListener("page-title-updated", (e) => {
    const ti = e.title || t.url;
    t.titleEl.textContent = ti;
    tabEl.title = ti;
  });
  webview.addEventListener("did-start-loading", () => { t.icoEl.innerHTML = TAB_ICON.spinner; });
  webview.addEventListener("did-stop-loading", () => {
    t.icoEl.innerHTML = TAB_ICON.globe;
    if (activeTabId === id) updateNav(t);
  });
  webview.addEventListener("did-navigate", () => {
    try { t.url = webview.getURL(); } catch {}
    if (activeTabId === id) updateNav(t);
  });
  webview.addEventListener("did-navigate-in-page", () => { if (activeTabId === id) updateNav(t); });

  if (opts.background) tabEl.classList.add("has-new");
  else setActiveTab(id);
}

function closeTab(id) {
  const t = webTabs.get(id);
  if (!t) return;
  const wasActive = activeTabId === id;
  try { t.webview.remove(); } catch {}
  t.tabEl.remove();
  webTabs.delete(id);
  if (wasActive) {
    const ids = [...webTabs.keys()];
    setActiveTab(ids.length ? ids[ids.length - 1] : "home");
  }
}

tabHome.addEventListener("click", () => setActiveTab("home"));
navBack.addEventListener("click", () => { const t = webTabs.get(activeTabId); if (t) { try { t.webview.goBack(); } catch {} } });
navFwd.addEventListener("click", () => { const t = webTabs.get(activeTabId); if (t) { try { t.webview.goForward(); } catch {} } });
navReload.addEventListener("click", () => { const t = webTabs.get(activeTabId); if (t) { try { t.webview.reload(); } catch {} } });
navExt.addEventListener("click", () => {
  const t = webTabs.get(activeTabId);
  if (!t || !bridge.openExternal) return;
  let url = t.url;
  try { url = t.webview.getURL() || t.url; } catch {}
  bridge.openExternal(url);
});

if (bridge && bridge.onOpenTab) bridge.onOpenTab((url) => openTab(url, { background: true }));

// ---- shell-side Zotero saver (read modal + search panel; null until set up) ----
// Each user owns a local API key encrypted by Electron safeStorage (Keychain on
// macOS). Main returns it only to this immutable shell; the sandboxed report
// never sees credentials and receives only opaque Zotero references.
let _zoteroCredentials = null;
let _zoteroSaver = null;
let _zoteroSaverTried = false;
let _zoteroCredentialGeneration = 0;
async function reloadZoteroCredentials() {
  const generation = ++_zoteroCredentialGeneration;
  let credentials = null;
  try {
    credentials = await bridge.getZoteroSession();
  } catch (error) {
    console.warn("[renderer] local Zotero credentials unavailable:", error);
  }
  if (generation !== _zoteroCredentialGeneration) return !!_zoteroCredentials;
  _zoteroCredentials = credentials && credentials.apiKey && credentials.userId
    ? credentials
    : null;
  _zoteroSaver = null;
  _zoteroSaverTried = false;
  if (zoteroSetupBtn) zoteroSetupBtn.hidden = !!_zoteroCredentials;
  return !!_zoteroCredentials;
}
const getZoteroSaver = () => {
  if (_zoteroSaverTried) return _zoteroSaver;
  _zoteroSaverTried = true;
  try {
    if (_zoteroCredentials && window.ZoteroSave) {
      _zoteroSaver = window.ZoteroSave.fromSession(_zoteroCredentials, bridge);
    }
  } catch (e) {
    console.warn("[renderer] zotero saver init failed:", e);
  }
  return _zoteroSaver;
};

function zoteroLibraryBaseId(value) {
  const id =
    typeof window.extractArxivId === "function"
      ? window.extractArxivId(String(value || ""))
      : null;
  const base =
    id && typeof window.baseArxivId === "function" ? window.baseArxivId(id) : id;
  return base ? String(base).toLowerCase() : null;
}

// The report iframe is a unique-origin sandbox and cannot reach this facade
// directly. The schema-checked parent RPC below is its only Zotero path.
window.paperReaderZotero = Object.freeze({
  isUnlocked() {
    return !!getZoteroSaver();
  },
  add(paper) {
    const saver = getZoteroSaver();
    if (!saver) return Promise.reject(new Error("请先在设置中配置自己的 Zotero API key"));
    return saver.add(paper);
  },
  remove(itemKey, expectedBaseId) {
    const saver = getZoteroSaver();
    if (!saver) return Promise.reject(new Error("请先在设置中配置自己的 Zotero API key"));
    return saver.remove(itemKey, expectedBaseId);
  },
  listDailyPaperArxivMap(rootName) {
    const saver = getZoteroSaver();
    if (!saver) return Promise.reject(new Error("请先在设置中配置自己的 Zotero API key"));
    return saver.listAddedMap(rootName);
  },
});

// ---- sandboxed report RPC -------------------------------------------------
// The live daily HTML is deliberately a unique-origin sandbox. It can request
// only these paper-scoped operations; it cannot see paperBridge, settings,
// decrypted credentials, or arbitrary filesystem/network IPC.
const REPORT_RPC_CHANNEL = "paperreader-report-v1";
const reportZoteroRefs = new Map(); // opaque ref -> { itemKey, baseId, title }
const reportZoteroKeyRefs = new Map(); // real key -> opaque ref
const reportNoteRefs = new Map(); // opaque ref -> { relNoExt, baseId }
const reportNotePathRefs = new Map(); // real relative path -> opaque ref
let readPapersCache = null;
let reportRpcRateStartedAt = 0;
let reportRpcRateCount = 0;

function resetReportRpcState() {
  reportZoteroRefs.clear();
  reportZoteroKeyRefs.clear();
  reportNoteRefs.clear();
  reportNotePathRefs.clear();
  delete frame.dataset.reportReady;
}

function reportNoteRef(relNoExt, baseId) {
  const safePath = cleanRelativeNotePath(relNoExt);
  const current = reportNotePathRefs.get(safePath);
  if (current) return current;
  const suffix =
    window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const ref = `nr_${suffix}`;
  reportNoteRefs.set(ref, { relNoExt: safePath, baseId });
  reportNotePathRefs.set(safePath, ref);
  return ref;
}

function reportItemRef(itemKey, metadata = {}) {
  if (!/^[A-Z0-9]{8}$/i.test(itemKey || "")) {
    throw new Error("Zotero 返回了无效的 item key");
  }
  const normalizedKey = String(itemKey).toUpperCase();
  const current = reportZoteroKeyRefs.get(normalizedKey);
  if (current) {
    const record = reportZoteroRefs.get(current);
    if (record) Object.assign(record, metadata);
    return current;
  }
  const suffix =
    window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const ref = `zr_${suffix}`;
  reportZoteroRefs.set(ref, { itemKey: normalizedKey, ...metadata });
  reportZoteroKeyRefs.set(normalizedKey, ref);
  return ref;
}

function requireCurrentReport(payload) {
  const requested = cleanString(payload && payload.reportFile, 100);
  if (!requested || requested !== reportFileName()) {
    throw new Error("报告来源不匹配，请刷新后重试");
  }
}

function cleanBaseArxivId(value) {
  const id = cleanString(value, 100).trim().toLowerCase();
  if (!/^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})$/.test(id)) return "";
  return id;
}

function arxivIdentity(url) {
  const match = String(url || "").match(
    /arxiv\.org\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?)/i
  );
  return match ? match[1] : "";
}

async function requireReportGesture(action, details = {}) {
  if (!bridge || typeof bridge.consumeReportGesture !== "function") {
    const error = new Error("当前 App 不支持安全单击授权，请升级或重启 App");
    error.code = "GESTURE_GATE_UNAVAILABLE";
    throw error;
  }
  // A real interaction in a child navigable activates its ancestors. This
  // renderer check is paired with a browser-process input sequence that can be
  // consumed only once; a boolean supplied by the report is never trusted.
  if (!navigator.userActivation || navigator.userActivation.isActive !== true) {
    const error = new Error("请直接点击操作按钮后重试");
    error.code = "USER_GESTURE_REQUIRED";
    throw error;
  }
  const result = await bridge.consumeReportGesture({
    action,
    reportFile: reportFileName(),
    identity: cleanString(details.identity, 200),
  });
  if (!result || result.allowed !== true) {
    const error = new Error(
      result && result.code === "USER_GESTURE_CONSUMED"
        ? "这次点击已执行过一个操作，请重新点击"
        : "请直接点击操作按钮后重试"
    );
    error.code = (result && result.code) || "USER_GESTURE_REQUIRED";
    throw error;
  }
}

function reportFileName() {
  try {
    return new URL(frame.src).pathname.split("/").pop() || "";
  } catch {
    return "";
  }
}

function cleanString(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function cleanArxivUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("无效的 arXiv URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.hostname !== "arxiv.org" ||
    url.port ||
    !/^\/(?:abs|pdf)\/(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?(?:\.pdf)?$/i.test(
      url.pathname
    )
  ) {
    throw new Error("只允许 arXiv 论文链接");
  }
  return url.href;
}

function cleanRelativeNotePath(value) {
  const rel = cleanString(value, 1000).trim();
  if (
    !rel ||
    /^[\\/]/.test(rel) ||
    /^[a-z]:/i.test(rel) ||
    /(^|[\\/])\.\.([\\/]|$)/.test(rel) ||
    /\0/.test(rel)
  ) {
    throw new Error("无效的笔记路径");
  }
  return rel;
}

function cleanPaper(value) {
  const paper = value && typeof value === "object" ? value : {};
  return {
    title: cleanString(paper.title, 4000),
    summary: cleanString(paper.summary, 100000),
    url: cleanArxivUrl(paper.url),
    authors: Array.isArray(paper.authors)
      ? paper.authors.slice(0, 100).map((name) => cleanString(name, 500))
      : [],
    keywords: Array.isArray(paper.keywords)
      ? paper.keywords.slice(0, 100).map((tag) => cleanString(tag, 200))
      : [],
    date: /^\d{4}-\d{2}-\d{2}$/.test(paper.date || "") ? paper.date : "",
  };
}

async function handleReportRequest(method, payload) {
  switch (method) {
    case "paper:read": {
      const p = payload && typeof payload === "object" ? payload : {};
      const reportFile = cleanString(p.reportFile, 100);
      if (reportFile !== reportFileName()) throw new Error("报告来源不匹配");
      const url = cleanArxivUrl(p.url);
      const derivedArxivId = arxivIdentity(url);
      if (!derivedArxivId) throw new Error("无法从论文 URL 派生 arXiv ID");
      const request = {
        url,
        title: cleanString(p.title, 4000),
        // Never trust a separately supplied ID: the gesture scope and the CLI
        // request must describe the exact same validated URL.
        arxivId: derivedArxivId,
        paperIndex: /^\d{1,5}$/.test(String(p.paperIndex)) ? String(p.paperIndex) : "",
        reportFile,
      };
      await requireReportGesture("paper-read", { identity: request.arxivId });
      return bridge.read(request);
    }
    case "job:list": {
      requireCurrentReport(payload);
      const currentFile = reportFileName();
      const jobs = await bridge.listJobs();
      return (Array.isArray(jobs) ? jobs : [])
        .filter((job) => job && job.reportFile === currentFile)
        .map((job) => ({
          id: cleanString(job.id, 128),
          reportFile: currentFile,
          paperIndex: cleanString(job.paperIndex, 10),
          state: cleanString(job.state, 30),
          phase: cleanString(job.phase, 40),
          label: cleanString(job.label, 300),
        }));
    }
    case "vault:readPapers": {
      requireCurrentReport(payload);
      const requested = Array.isArray(payload && payload.baseIds)
        ? payload.baseIds.slice(0, 250).map(cleanBaseArxivId).filter(Boolean)
        : [];
      if (!requested.length) return {};
      if (!readPapersCache || Date.now() - readPapersCache.at > 30_000) {
        readPapersCache = { at: Date.now(), value: await bridge.readPapers() };
      }
      const source = readPapersCache.value;
      const scoped = {};
      for (const baseId of new Set(requested)) {
        const entry = source && source[baseId];
        if (!entry || !entry.rel) continue;
        scoped[baseId] = {
          rel: reportNoteRef(entry.rel, baseId),
          read: entry.read === true,
        };
      }
      return scoped;
    }
    case "vault:openNote": {
      requireCurrentReport(payload);
      const record = reportNoteRefs.get(cleanString(payload && payload.noteRef, 100));
      if (!record) throw new Error("笔记引用已失效，请刷新后重试");
      await requireReportGesture("vault-open", { identity: record.baseId });
      return bridge.openNote(record.relNoExt);
    }
    case "vault:setReadStatus": {
      requireCurrentReport(payload);
      const record = reportNoteRefs.get(cleanString(payload && payload.noteRef, 100));
      if (!record) throw new Error("笔记引用已失效，请刷新后重试");
      await requireReportGesture("vault-update", {
        identity: `${record.baseId}:${payload && payload.read ? "read" : "unread"}`,
      });
      return bridge.setReadStatus(record.relNoExt, !!(payload && payload.read));
    }
    case "job:openInObsidian": {
      requireCurrentReport(payload);
      const jobId = cleanString(payload && payload.jobId, 128);
      if (!/^[a-z0-9_-]+$/i.test(jobId)) throw new Error("无效的任务 ID");
      const jobs = await bridge.listJobs();
      if (!(jobs || []).some((job) => job && job.id === jobId && job.reportFile === reportFileName())) {
        throw new Error("任务不属于当前报告");
      }
      await requireReportGesture("vault-open", { identity: jobId });
      return bridge.openInObsidian(jobId);
    }
    case "zotero:add": {
      requireCurrentReport(payload);
      const paper = cleanPaper(payload && payload.paper);
      const identity = arxivIdentity(paper.url);
      await requireReportGesture("zotero-add", { identity });
      const result = await window.paperReaderZotero.add(paper);
      if (!result || result.ok !== true) throw new Error("Zotero 未返回有效结果");
      const baseId = cleanBaseArxivId(identity.replace(/v\d+$/i, ""));
      const managed =
        result.managed !== false && result.status !== "already-in-library";
      if (managed && !result.itemKey) throw new Error("Zotero 未返回已创建条目");
      const itemRef = managed
        ? reportItemRef(result.itemKey, { baseId, title: paper.title })
        : null;
      const pdf = result.pdf
        ? {
            storage: cleanString(result.pdf.storage, 40),
            state: cleanString(result.pdf.state, 40),
            cloudConfirmed: result.pdf.cloudConfirmed === true,
          }
        : undefined;
      return {
        ok: result.ok === true,
        status: cleanString(result.status, 40),
        state: managed ? "managed" : "existing",
        ...(itemRef ? { itemKey: itemRef } : {}),
        ...(pdf ? { pdf } : {}),
      };
    }
    case "zotero:remove": {
      requireCurrentReport(payload);
      const itemRef = cleanString(payload && payload.itemRef, 100);
      const record = reportZoteroRefs.get(itemRef);
      if (!record) throw new Error("Zotero 条目引用已失效，请刷新后重试");
      await requireReportGesture("zotero-remove", { identity: record.baseId });
      const result = await window.paperReaderZotero.remove(record.itemKey, record.baseId);
      reportZoteroRefs.delete(itemRef);
      reportZoteroKeyRefs.delete(record.itemKey);
      let remainingItemKey = null;
      if (result && result.remainingItemKey) {
        remainingItemKey = reportItemRef(result.remainingItemKey, {
          baseId: record.baseId,
          title: record.title,
        });
      }
      return {
        ok: !!(result && result.ok),
        linkedFilePreserved: !!(result && result.linkedFilePreserved),
        remainingItemKey,
        remainingDuplicates: Number(result && result.remainingDuplicates) || 0,
        libraryMatchRemaining: !!(result && result.libraryMatchRemaining),
      };
    }
    case "zotero:list": {
      requireCurrentReport(payload);
      const requested = Array.isArray(payload && payload.baseIds)
        ? payload.baseIds.slice(0, 250).map(cleanBaseArxivId).filter(Boolean)
        : [];
      if (!requested.length) return {};
      const source = await window.paperReaderZotero.listDailyPaperArxivMap("Daily Paper");
      const scoped = {};
      for (const baseId of new Set(requested)) {
        const match = source && source[baseId];
        if (!match) continue;
        if (typeof match === "string") {
          scoped[baseId] = {
            state: "managed",
            itemKey: reportItemRef(match, { baseId }),
          };
          continue;
        }
        if (match.state === "managed" && match.itemKey) {
          scoped[baseId] = {
            state: "managed",
            itemKey: reportItemRef(match.itemKey, { baseId }),
          };
        } else {
          scoped[baseId] = { state: "existing" };
        }
      }
      return scoped;
    }
    default:
      throw new Error("不允许的 report RPC 方法");
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.origin !== "null") return;
  const message = event.data;
  if (!message || message.channel !== REPORT_RPC_CHANNEL) return;
  if (message.type === "event" && message.event === "ready") {
    frame.dataset.reportReady = "true";
    return;
  }
  if (message.type !== "request" || typeof message.id !== "string") return;
  const id = message.id.slice(0, 100);
  const now = Date.now();
  if (now - reportRpcRateStartedAt >= 1000) {
    reportRpcRateStartedAt = now;
    reportRpcRateCount = 0;
  }
  reportRpcRateCount += 1;
  if (reportRpcRateCount > 40) {
    try {
      event.source.postMessage(
        {
          channel: REPORT_RPC_CHANNEL,
          type: "response",
          id,
          ok: false,
          error: { message: "报告请求过于频繁", code: "RPC_RATE_LIMIT" },
        },
        "*"
      );
    } catch {}
    return;
  }
  Promise.resolve()
    .then(() => handleReportRequest(message.method, message.payload))
    .then(
      (result) => ({ ok: true, result }),
      (error) => ({
        ok: false,
        error: {
          message: (error && error.message) || String(error),
          code: (error && error.code) || "REPORT_REQUEST_FAILED",
        },
      })
    )
    .then((response) => {
      try {
        event.source.postMessage(
          { channel: REPORT_RPC_CHANNEL, type: "response", id, ...response },
          "*"
        );
      } catch {}
    });
});
function looksLikeArxiv(raw) {
  const v = (raw || "").trim();
  if (!v) return false;
  return (
    /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?(?:\.pdf)?(?:[/?#].*)?$/i.test(v) ||
    /^(?:arxiv:\s*)?(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?$/i.test(v)
  );
}

// ---- "read any paper" modal (topbar 读论文 button) ----
const readOverlay = document.getElementById("read-overlay");
const readInput = document.getElementById("read-input");
const readErr = document.getElementById("read-err");
const readGo = document.getElementById("read-go");
const readZoteroBtn = document.getElementById("read-zotero");
let readZoteroLookupSequence = 0;

// The 加入 Zotero action only applies to an arXiv link/ID (a name has no ID until
// the read resolves it) and is shown only after the user configures Zotero.
function updateReadZoteroBtn() {
  if (!readZoteroBtn) return;
  const saver = getZoteroSaver();
  if (!saver) {
    readZoteroBtn.style.display = "none";
    return;
  }
  readZoteroBtn.style.display = "inline-flex";
  const ok = looksLikeArxiv(readInput.value);
  readZoteroBtn.disabled = !ok;
  readZoteroBtn.textContent = "加入 Zotero";
  readZoteroBtn.title = ok ? "把这篇加入 Zotero（PDF）" : "仅支持 arXiv 链接 / ID（论文名请直接开读）";
  const match = String(readInput.value || "").match(
    /((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7}))(?:v\d+)?/i
  );
  const baseId = match ? match[1].toLowerCase() : null;
  const sequence = ++readZoteroLookupSequence;
  const credentialGeneration = _zoteroCredentialGeneration;
  if (!ok || !baseId) return;
  saver
    .listAddedMap("Daily Paper")
    .then((map) => {
      if (
        sequence !== readZoteroLookupSequence ||
        credentialGeneration !== _zoteroCredentialGeneration ||
        !map ||
        !map[baseId]
      ) return;
      readZoteroBtn.disabled = true;
      readZoteroBtn.textContent = "已在 Zotero";
      readZoteroBtn.title = "你的 Zotero 库中已有此论文";
    })
    .catch(() => {
      // A transient reconcile failure must not disable the explicit Add path;
      // Saver.add performs the same duplicate check before any write.
    });
}

function openReadModal() {
  readErr.textContent = "";
  readInput.value = "";
  readOverlay.style.display = "flex";
  updateReadZoteroBtn();
  setTimeout(() => readInput.focus(), 50);
}
function closeReadModal() {
  readOverlay.style.display = "none";
}
// arxiv link / bare id → a canonical URL; anything else → treat as a name query.
function toArxivUrl(s) {
  const v = (s || "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return looksLikeArxiv(v) ? v : null;
  const m = v.match(
    /^(?:arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?)$/i
  );
  if (m) return `https://arxiv.org/abs/${m[1]}`;
  return null;
}
async function submitRead() {
  const raw = readInput.value.trim();
  if (!raw) return;
  readErr.textContent = "";
  readGo.disabled = true;
  const url = toArxivUrl(raw);
  const payload = url ? { url, title: url } : { query: raw, title: raw };
  try {
    const r = await bridge.read(payload);
    if (r && (r.ok || r.reason === "already-running")) {
      closeReadModal();
    } else {
      readErr.textContent = "启动失败：" + ((r && r.reason) || "未知错误");
    }
  } catch (e) {
    readErr.textContent = "启动失败：" + e.message;
  } finally {
    readGo.disabled = false;
  }
}
async function submitReadZotero() {
  const raw = readInput.value.trim();
  const saver = getZoteroSaver();
  if (!saver || !looksLikeArxiv(raw)) return;
  readErr.textContent = "";
  readZoteroBtn.disabled = true;
  const orig = readZoteroBtn.textContent;
  readZoteroBtn.textContent = "加入中…";
  try {
    const r = await bridge.arxivMeta(raw);
    if (!r || !r.ok) throw new Error((r && r.reason) || "获取论文信息失败");
    const m = r.meta;
    const res = await saver.add({
      title: m.title,
      summary: m.summary,
      url: m.url,
      authors: m.authors,
      keywords: m.categories,
      published: m.published,
    });
    showShellToast(
      res.status === "already-in-library"
        ? "已在你的 Zotero 库中（未重复创建或改动原条目）"
        : res.status === "already-added"
        ? "已在 Zotero 中（未重复创建）"
        : "已加入 Zotero（OneDrive 云端已确认）",
      "success"
    );
    closeReadModal();
  } catch (e) {
    readErr.textContent = "加入 Zotero 失败：" + e.message;
  } finally {
    readZoteroBtn.disabled = false;
    readZoteroBtn.textContent = orig;
  }
}
document.getElementById("btn-read-any").addEventListener("click", openReadModal);
document.getElementById("read-cancel").addEventListener("click", closeReadModal);
readGo.addEventListener("click", submitRead);
readZoteroBtn.addEventListener("click", submitReadZotero);
readInput.addEventListener("input", updateReadZoteroBtn);
readInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitRead();
  else if (e.key === "Escape") closeReadModal();
});
readOverlay.addEventListener("click", (e) => {
  if (e.target === readOverlay) closeReadModal();
});

// ---- search panel (查找文献) ----
const searchOverlay = document.getElementById("search-overlay");
const searchInput = document.getElementById("search-input");
const searchStatus = document.getElementById("search-status");
const searchResults = document.getElementById("search-results");
const SEARCH_EXAMPLES = [
  "vision-language-action",
  "world model",
  "autonomous driving",
  "humanoid",
  "manipulation",
  "diffusion policy",
];
const SR_READ_LABELS = { idle: "帮我读", busy: "读取中", done: "已生成", error: "重试" };

let miniSearch = null;
let indexState = "none"; // none | loading | ready | error
let searchTotal = 0;
let searchDateRange = "";
let searchIndexIsLegacy = false;
const searchReadByJob = new Map(); // jobId -> the search result's read button
let searchZoteroReconcileSequence = 0;

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function openSearch() {
  searchOverlay.style.display = "flex";
  setTimeout(() => searchInput.focus(), 50);
  if (indexState === "none") loadSearchIndex();
  else if (indexState === "ready") renderSearch();
}
function closeSearch() {
  searchOverlay.style.display = "none";
}

async function loadSearchIndex() {
  indexState = "loading";
  searchStatus.textContent = "正在加载检索索引（首次较慢，需联网拉取）…";
  searchResults.innerHTML = "";
  try {
    const { papers: data, legacy } = await SearchIndexLoader.loadSearchIndex({
      baseUrl: "site/search_index",
      legacyUrl: "site/search_index.json",
      onProgress: ({ loadedShards, totalShards, loadedPapers, totalPapers }) => {
        searchStatus.textContent = `正在加载检索索引 ${loadedShards}/${totalShards}（${loadedPapers}/${totalPapers} 篇）…`;
      },
      onFallback: (err) => {
        console.warn("Sharded search index unavailable; using compatibility index:", err);
        searchStatus.textContent = "完整索引不可用，正在加载兼容索引…";
      },
    });
    searchIndexIsLegacy = legacy;
    data.forEach((p, i) => {
      p.id = i;
      p.authorsText = (p.authors || []).join(", ");
    });
    searchTotal = data.length;
    const dates = data.map((p) => p.date).filter(Boolean).sort();
    if (dates.length) searchDateRange = `${dates[0]} → ${dates[dates.length - 1]}`;
    miniSearch = new MiniSearch({
      fields: ["title", "summary", "summary_zh", "tldr", "tldr_zh", "authorsText"],
      storeFields: ["title", "summary", "summary_zh", "tldr", "tldr_zh", "url", "date", "authors", "authorsText", "categories", "score", "topic"],
      searchOptions: {
        boost: { title: 5, authorsText: 3, tldr: 2, tldr_zh: 2, summary: 1, summary_zh: 1 },
        combineWith: "AND",
        fuzzy: (t) => (t.length > 5 ? 0.2 : false),
        prefix: (t) => t.length >= 3,
      },
    });
    // Building ~50k documents synchronously freezes the shell for several
    // seconds, which makes every visible control look broken while Search is
    // opened for the first time. MiniSearch's async path indexes in small
    // timer-yielding chunks so Close, Settings, date navigation, etc. keep
    // receiving input throughout the build.
    searchStatus.textContent = `正在构建检索索引（${data.length} 篇，期间仍可继续操作）…`;
    await miniSearch.addAllAsync(data, { chunkSize: 100 });
    indexState = "ready";
    renderSearch();
  } catch (e) {
    indexState = "none"; // allow a retry on next open
    searchStatus.textContent = "";
    searchResults.innerHTML = `<div class="search-empty">索引加载失败：${escHtml(e.message)}<br/>请检查网络后重新打开搜索（首次需联网拉取索引分片）。</div>`;
  }
}

function renderIdleHint() {
  const scope = searchIndexIsLegacy
    ? "（兼容模式，仅高相关论文）"
    : searchDateRange
      ? `（${escHtml(searchDateRange)}）`
      : "";
  searchStatus.innerHTML = `索引中共 <span class="count">${searchTotal}</span> 篇论文${scope}`;
  const chips = SEARCH_EXAMPLES.map(
    (e) => `<button class="search-ex" type="button" data-q="${escHtml(e)}">${escHtml(e)}</button>`
  ).join("");
  searchResults.innerHTML = `<div class="search-empty">试试这些方向，或输入任意中英文关键词（≥3 字符开始匹配）<div class="search-examples">${chips}</div></div>`;
  searchResults.querySelectorAll(".search-ex").forEach((c) =>
    c.addEventListener("click", () => {
      searchInput.value = c.dataset.q;
      searchInput.focus();
      renderSearch();
    })
  );
}

function renderSearch() {
  if (indexState !== "ready") return;
  const q = searchInput.value.trim();
  if (!q) return renderIdleHint();
  const results = miniSearch.search(q);
  searchStatus.innerHTML = `找到 <span class="count">${results.length}</span> 篇匹配 "${escHtml(q)}"`;
  if (!results.length) {
    searchResults.innerHTML = `<div class="search-empty">没找到匹配，换个更宽泛的关键词试试。</div>`;
    return;
  }
  searchResults.innerHTML = "";
  const saver = getZoteroSaver();
  results.slice(0, 100).forEach((r) => searchResults.appendChild(buildResultCard(r, saver)));
  if (saver) void reconcileSearchZoteroButtons(saver);
  if (results.length > 100) {
    const more = document.createElement("div");
    more.className = "search-empty";
    more.textContent = `仅显示前 100 条（共 ${results.length} 条），请缩小范围。`;
    searchResults.appendChild(more);
  }
}

function buildResultCard(r, saver) {
  const desc = r.tldr_zh || r.tldr || (r.summary_zh || r.summary || "").slice(0, 200);
  const cats = (r.categories || []).slice(0, 1).join(", ");
  const card = document.createElement("div");
  card.className = "sr-card";
  card.innerHTML =
    `<div class="sr-top"><span class="sr-title">${escHtml(r.title)}</span>${r.date ? `<span class="sr-date">${escHtml(r.date)}</span>` : ""}</div>` +
    (r.authorsText ? `<div class="sr-authors">${escHtml(r.authorsText)}</div>` : "") +
    `<div class="sr-tldr">${escHtml(desc)}</div>` +
    `<div class="sr-foot">` +
    (r.topic ? `<span class="sr-chip">${escHtml(r.topic)}</span>` : "") +
    (r.score ? `<span class="sr-chip">★ ${escHtml(r.score)}</span>` : "") +
    (cats ? `<span class="sr-chip">${escHtml(cats)}</span>` : "") +
    `<span class="sr-spacer"></span>` +
    `<button class="sr-btn sr-read" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg><span class="lbl">帮我读</span></button>` +
    (saver
      ? `<button class="sr-btn sr-zotero" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg><span class="lbl">加入 Zotero</span></button>`
      : "") +
    `</div>`;

  card.querySelector(".sr-title").addEventListener("click", () => {
    if (r.url) {
      openTab(r.url, { background: false });
      closeSearch();
    }
  });
  card.querySelector(".sr-read").addEventListener("click", (e) => startSearchRead(e.currentTarget, r));
  if (saver) {
    const zoteroButton = card.querySelector(".sr-zotero");
    zoteroButton.dataset.baseId = zoteroLibraryBaseId(r.url) || "";
    zoteroButton.addEventListener("click", (e) => {
      const liveSaver = getZoteroSaver();
      if (!liveSaver) {
        showShellToast("请先在设置中配置自己的 Zotero API key", "info");
        return;
      }
      addSearchZotero(e.currentTarget, r, liveSaver);
    });
  }
  return card;
}

async function reconcileSearchZoteroButtons(saver) {
  if (!saver) return;
  const sequence = ++searchZoteroReconcileSequence;
  const credentialGeneration = _zoteroCredentialGeneration;
  try {
    const map = await saver.listAddedMap("Daily Paper");
    if (
      sequence !== searchZoteroReconcileSequence ||
      credentialGeneration !== _zoteroCredentialGeneration
    ) return;
    for (const btn of searchResults.querySelectorAll(".sr-zotero")) {
      const baseId = btn.dataset.baseId;
      if (!baseId || !map || !map[baseId]) continue;
      btn.classList.add("saved");
      btn.title = "你的 Zotero 库中已有此论文";
      const label = btn.querySelector(".lbl");
      if (label) label.textContent = "已在库中";
    }
  } catch (error) {
    console.warn("[renderer] search Zotero reconcile failed:", error);
  }
}

function setSearchReadBtn(btn, state, label) {
  btn.classList.toggle("busy", state === "busy");
  btn.classList.toggle("done", state === "done");
  const l = btn.querySelector(".lbl");
  if (l) l.textContent = label || SR_READ_LABELS[state] || SR_READ_LABELS.idle;
}

function startSearchRead(btn, r) {
  if (btn.classList.contains("busy")) return;
  setSearchReadBtn(btn, "busy");
  bridge
    .read({ url: r.url, title: r.title, arxivId: window.extractArxivId ? window.extractArxivId(r.url) : null })
    .then((res) => {
      if (res && (res.ok || res.reason === "already-running")) {
        if (res.jobId) searchReadByJob.set(res.jobId, btn);
        setSearchReadBtn(btn, "busy", "读取中");
        showShellToast("已加入阅读任务，进度见右侧", "info");
      } else {
        setSearchReadBtn(btn, "error");
        showShellToast(`启动失败：${(res && res.reason) || "未知错误"}`, "error");
      }
    })
    .catch((e) => {
      setSearchReadBtn(btn, "error");
      showShellToast(`启动失败：${e.message}`, "error");
    });
}

async function addSearchZotero(btn, r, saver) {
  if (btn.disabled) return;
  if (btn.classList.contains("saved")) {
    showShellToast("这篇论文已在你的 Zotero 库中，PaperReader 不会重复创建", "info");
    return;
  }
  btn.disabled = true;
  const l = btn.querySelector(".lbl");
  const orig = l ? l.textContent : "";
  if (l) l.textContent = "加入中…";
  try {
    const res = await saver.add({
      title: r.title,
      summary: r.summary || r.summary_zh,
      url: r.url,
      authors: r.authors,
      keywords: r.categories,
      date: r.date,
    });
    btn.classList.add("saved");
    if (l) {
      l.textContent = res.status === "already-in-library" ? "已在库中" : "已加入";
    }
    showShellToast(
      res.status === "already-in-library"
        ? "已在你的 Zotero 库中（未重复创建或改动原条目）"
        : res.status === "already-added"
        ? "已在 Zotero 中（未重复创建）"
        : "已加入 Zotero（OneDrive 云端已确认）",
      "success"
    );
  } catch (e) {
    if (l) l.textContent = orig;
    showShellToast(`加入 Zotero 失败：${e.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

// Reflect a read job's progress on its originating search-result button.
function applySearchProgress(evt) {
  if (!evt || !evt.jobId) return;
  const btn = searchReadByJob.get(evt.jobId);
  if (!btn) return;
  if (evt.state === "done") setSearchReadBtn(btn, "done");
  else if (evt.state === "error") setSearchReadBtn(btn, "error");
  else if (evt.state === "canceled") setSearchReadBtn(btn, "idle");
  else setSearchReadBtn(btn, "busy", "读取中");
}

let searchDebounce;
searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderSearch, 200);
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSearch();
});
document.getElementById("btn-search").addEventListener("click", openSearch);
document.getElementById("search-close").addEventListener("click", closeSearch);
searchOverlay.addEventListener("click", (e) => {
  if (e.target === searchOverlay) closeSearch();
});

envBadge.addEventListener("click", () => bridge.openSettings());

// ---- env badge ----
async function refreshEnv() {
  try {
    const p = await bridge.probeEnv();
    const providerName = p.provider === "codex" ? "Codex" : p.provider === "trae" ? "Trae" : "Claude";
    if (p.ready) {
      envBadge.textContent = `${providerName} 就绪`;
      envBadge.className = "ok";
    } else {
      envBadge.textContent = !p.vault.ok
        ? "vault 未就绪"
        : !p.cli.ok
          ? `${providerName} 未就绪`
          : p.python && !p.python.ok
            ? "Python 未就绪"
            : "环境未就绪";
      envBadge.className = "warn";
    }
  } catch {}
}

// ---- progress → sidebar + relay to iframe ----
function relayToFrame(evt) {
  try {
    const w = frame.contentWindow;
    if (w && evt && evt.reportFile === reportFileName()) {
      w.postMessage(
        {
          channel: REPORT_RPC_CHANNEL,
          type: "event",
          event: "progress",
          payload: {
            jobId: cleanString(evt.jobId || evt.id, 128),
            reportFile: reportFileName(),
            paperIndex: cleanString(evt.paperIndex, 10),
            state: cleanString(evt.state, 30),
            phase: cleanString(evt.phase, 40),
            label: cleanString(evt.label, 300),
          },
        },
        "*"
      );
    }
  } catch {}
}

const PHASE_PCT = { init: 6, fetch: 16, text: 32, figures: 56, code: 68, read_image: 60, write: 86, done: 100, warn: null, error: 100 };

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function fmtTokens(n) {
  n = n || 0;
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + "k";
  return (n / 1e6).toFixed(2) + "M";
}
// One compact line: ↑input ↓output · cache · $cost. "" when no usage yet.
function tokensLine(u, cost) {
  if (!u) return "";
  const parts = [`↑ ${fmtTokens(u.input)}`, `↓ ${fmtTokens(u.output)}`];
  const cache = (u.cacheRead || 0) + (u.cacheCreate || 0);
  if (cache) parts.push(`缓存 ${fmtTokens(cache)}`);
  if (typeof cost === "number") parts.push(`$${cost.toFixed(2)}`);
  return parts.join("  ·  ");
}

function makeRow(evt) {
  const el = document.createElement("div");
  el.className = "job";
  el.innerHTML = `
    <div class="job-title"></div>
    <div class="job-meta"><span class="job-phase"></span><span class="job-elapsed"></span></div>
    <div class="job-bar"><i></i></div>
    <div class="job-tokens" style="display:none"></div>
    <div class="job-detail" style="display:none"></div>
    <div class="job-actions"></div>`;
  el.querySelector(".job-title").textContent = evt.title || evt.url || "(paper)";
  jobListEl.insertBefore(el, jobListEl.firstChild);
  return el;
}

function renderActions(rec) {
  const wrap = rec.el.querySelector(".job-actions");
  wrap.innerHTML = "";
  const add = (label, cls, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener("click", fn);
    wrap.appendChild(b);
  };
  const d = rec.data;
  if (d.state === "running" || d.state === "queued") {
    add("取消", "danger", () => bridge.cancel(d.jobId));
  } else if (d.state === "done") {
    add("在 Obsidian 打开", "primary", () => bridge.openInObsidian(d.jobId));
    add("文件夹", "", () => bridge.openFolder(d.jobId));
  } else if (d.state === "error") {
    add("重试", "primary", () => {
      bridge.read({
        url: d.url,
        title: d.title,
        arxivId: d.arxivId,
        paperIndex: d.paperIndex,
        reportFile: d.reportFile,
      });
    });
  }
}

function upsertJob(evt) {
  if (!evt || !evt.jobId) return;
  jobEmptyEl.style.display = "none";
  let rec = rows.get(evt.jobId);
  if (!rec) {
    rec = { el: makeRow(evt), data: {} };
    rows.set(evt.jobId, rec);
  }
  // merge (later events may omit fields like url on phase updates)
  rec.data = { ...rec.data, ...evt };
  const d = rec.data;
  const el = rec.el;

  el.classList.remove("running", "done", "error", "canceled");
  if (d.state === "running" || d.state === "queued") el.classList.add("running");
  else if (d.state) el.classList.add(d.state);

  el.querySelector(".job-phase").textContent =
    d.label || { queued: "排队中", running: "读取中", done: "已生成", error: "失败", canceled: "已取消" }[d.state] || "";

  const pct = d.state === "done" ? 100 : d.state === "queued" ? 4 : PHASE_PCT[d.phase];
  if (pct != null) el.querySelector(".job-bar > i").style.width = pct + "%";

  const detailEl = el.querySelector(".job-detail");
  if (d.detail && (d.state === "running" || d.state === "queued")) {
    detailEl.style.display = "";
    detailEl.textContent = d.detail;
  } else if (d.state === "error") {
    detailEl.style.display = "";
    detailEl.textContent = d.errorText || d.label || "";
  } else {
    detailEl.style.display = "none";
  }

  // Frozen total time on terminal states (the live ticker handles running/queued).
  if (d.state === "done" || d.state === "error" || d.state === "canceled") {
    const ms = d.durationMs != null ? d.durationMs : d.startedAt ? Date.now() - d.startedAt : 0;
    el.querySelector(".job-elapsed").textContent = fmtElapsed(ms);
  }
  // Per-read token usage (present once the result event arrives, i.e. when done).
  const tokEl = el.querySelector(".job-tokens");
  if (tokEl) {
    const line = tokensLine(d.usage, d.costUsd);
    tokEl.textContent = line;
    tokEl.style.display = line ? "" : "none";
  }

  renderActions(rec);
}

// elapsed ticker for active rows
setInterval(() => {
  const now = Date.now();
  rows.forEach((rec) => {
    const d = rec.data;
    const elapsedEl = rec.el.querySelector(".job-elapsed");
    if (d.state === "running" || d.state === "queued") {
      elapsedEl.textContent = fmtElapsed(now - (d.startedAt || now));
    }
  });
}, 1000);

// restore any jobs already in flight (e.g. settings re-opened the shell)
async function restoreJobs() {
  try {
    const jobs = await bridge.listJobs();
    (jobs || []).forEach((j) => upsertJob({ ...j, jobId: j.id }));
  } catch {}
}

if (bridge && bridge.onProgress) {
  bridge.onProgress((evt) => {
    upsertJob(evt);
    relayToFrame(evt);
    applySearchProgress(evt);
  });
}

let appStarted = false;
function startApp() {
  if (appStarted) return;
  appStarted = true;
  loadReports();
  refreshEnv();
  restoreJobs();
  setInterval(refreshEnv, 30000);
}

if (bridge && typeof bridge.onZoteroCredentialsChanged === "function") {
  bridge.onZoteroCredentialsChanged(async (status) => {
    const configured = await reloadZoteroCredentials();
    if (select.value) setReport(select.value);
    updateReadZoteroBtn();
    if (indexState === "ready") renderSearch();
    showShellToast(
      configured && status && status.configured !== false
        ? "Zotero 已连接；Add to Zotero 现在可用"
        : "Zotero 已断开；可在设置中重新配置",
      configured ? "success" : "info"
    );
  });
}

(async function bootstrapApp() {
  const configured = await reloadZoteroCredentials();
  startApp();
  if (!configured) {
    showShellToast("Zotero 尚未配置；需要时可在设置中粘贴自己的 API key", "info");
  }
})();
