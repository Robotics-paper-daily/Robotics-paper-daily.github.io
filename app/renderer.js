// Shell renderer (top frame). Owns the report iframe, the date picker, and the
// progress sidebar. It is the single subscriber to paperBridge.onProgress and
// relays each event into the report iframe (same-origin under app://) so the
// originating card can reflect its own job.

const bridge = window.paperBridge;
const frame = document.getElementById("report-frame");
const select = document.getElementById("report-select");
const dateLabel = document.getElementById("date-label");
const datePrev = document.getElementById("date-prev");
const dateNext = document.getElementById("date-next");
const jobListEl = document.getElementById("job-list");
const jobEmptyEl = document.getElementById("job-empty");
const envBadge = document.getElementById("env-badge");

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
  frame.src = `site/daily_html/${file}`;
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
let activeTabId = "home";
let tabSeq = 0;

function setActiveTab(id) {
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

// ---- shell-side Zotero saver (read modal + search panel; null in guest mode) ----
let _zoteroSaver = null;
let _zoteroSaverTried = false;
function getZoteroSaver() {
  if (_zoteroSaverTried) return _zoteroSaver;
  _zoteroSaverTried = true;
  try {
    const raw = sessionStorage.getItem("zotero_secrets");
    if (raw && window.ZoteroSave) _zoteroSaver = window.ZoteroSave.fromSession(JSON.parse(raw));
  } catch (e) {
    console.warn("[renderer] zotero saver init failed:", e);
  }
  return _zoteroSaver;
}
function looksLikeArxiv(raw) {
  const v = (raw || "").trim();
  if (!v) return false;
  return /arxiv\.org\/(abs|pdf)\//i.test(v) || /\b\d{4}\.\d{4,5}(v\d+)?\b/.test(v) || /^arxiv:/i.test(v);
}

// ---- "read any paper" modal (topbar 读论文 button) ----
const readOverlay = document.getElementById("read-overlay");
const readInput = document.getElementById("read-input");
const readErr = document.getElementById("read-err");
const readGo = document.getElementById("read-go");
const readZoteroBtn = document.getElementById("read-zotero");

// The 加入 Zotero action only applies to an arxiv link/ID (a name has no id until
// the read resolves it) and only in personal mode.
function updateReadZoteroBtn() {
  if (!readZoteroBtn) return;
  if (!getZoteroSaver()) {
    readZoteroBtn.style.display = "none";
    return;
  }
  readZoteroBtn.style.display = "inline-flex";
  const ok = looksLikeArxiv(readInput.value);
  readZoteroBtn.disabled = !ok;
  readZoteroBtn.title = ok ? "把这篇加入 Zotero（PDF）" : "仅支持 arXiv 链接 / ID（论文名请直接开读）";
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
  if (/^https?:\/\//i.test(v)) return v;
  const m = v.match(/^\s*(\d{4}\.\d{4,5}(?:v\d+)?)\s*$/);
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
    });
    showShellToast(
      res.pdf && res.pdf.ok ? "已加入 Zotero（PDF 已上传 WebDAV）" : "已加入 Zotero（仅链接）",
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
const searchReadByJob = new Map(); // jobId -> the search result's read button

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
    const data = await (await fetch("site/search_index.json")).json();
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
    miniSearch.addAll(data);
    indexState = "ready";
    renderSearch();
  } catch (e) {
    indexState = "none"; // allow a retry on next open
    searchStatus.textContent = "";
    searchResults.innerHTML = `<div class="search-empty">索引加载失败：${escHtml(e.message)}<br/>请检查网络后重新打开搜索（首次需联网拉取 search_index.json）。</div>`;
  }
}

function renderIdleHint() {
  searchStatus.innerHTML = `索引中共 <span class="count">${searchTotal}</span> 篇论文${searchDateRange ? `（${escHtml(searchDateRange)}）` : ""}`;
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
    card.querySelector(".sr-zotero").addEventListener("click", (e) => addSearchZotero(e.currentTarget, r, saver));
  }
  return card;
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
  if (btn.disabled || btn.classList.contains("saved")) return;
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
    });
    btn.classList.add("saved");
    if (l) l.textContent = "已加入";
    showShellToast(
      res.pdf && res.pdf.ok ? "已加入 Zotero（PDF 已上传 WebDAV）" : "已加入 Zotero（仅链接）",
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
    if (p.ready) {
      envBadge.textContent = "环境就绪";
      envBadge.className = "ok";
    } else {
      envBadge.textContent = !p.claude.ok ? "claude 未就绪" : "vault 未就绪";
      envBadge.className = "warn";
    }
  } catch {}
}

// ---- progress → sidebar + relay to iframe ----
function relayToFrame(evt) {
  try {
    const w = frame.contentWindow;
    if (w && typeof w.__readPaperApply === "function") w.__readPaperApply(evt);
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

function startApp() {
  loadReports();
  refreshEnv();
  restoreJobs();
  setInterval(refreshEnv, 30000);
}

// Personal-mode unlock gate (mirrors index.html). If the encrypted Zotero
// bundle is present and there's no session yet, ask for the password BEFORE
// loading the report — so the iframe's like.js sees the session and reveals the
// Zotero buttons. Skipping (or no bundle / already unlocked) → load straight to
// guest mode, where only 帮我读 shows.
(function unlockGate() {
  const overlay = document.getElementById("unlock-overlay");
  const pw = document.getElementById("unlock-pw");
  const err = document.getElementById("unlock-err");
  const go = document.getElementById("unlock-go");
  const skip = document.getElementById("unlock-skip");

  const haveSession = !!sessionStorage.getItem("zotero_secrets");
  const haveBundle = !!window.__ZOTERO_ENC && typeof window.decryptZoteroBundle === "function";
  if (haveSession || !haveBundle) {
    startApp();
    return;
  }

  overlay.style.display = "flex";
  setTimeout(() => pw.focus(), 50);

  async function unlock() {
    err.textContent = "";
    if (!pw.value) return;
    go.disabled = true;
    const label = go.textContent;
    go.textContent = "验证中…";
    try {
      const creds = await window.decryptZoteroBundle(pw.value);
      sessionStorage.setItem("zotero_secrets", JSON.stringify(creds));
      overlay.style.display = "none";
      startApp();
    } catch (e) {
      go.disabled = false;
      go.textContent = label;
      err.textContent = e.message === "wrong password" ? "密码错误，请重试" : "验证失败：" + e.message;
      pw.focus();
      pw.select();
    }
  }
  go.addEventListener("click", unlock);
  pw.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlock();
  });
  skip.addEventListener("click", () => {
    overlay.style.display = "none";
    startApp();
  });
})();
