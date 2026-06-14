// Shell renderer (top frame). Owns the report iframe, the date picker, and the
// progress sidebar. It is the single subscriber to paperBridge.onProgress and
// relays each event into the report iframe (same-origin under app://) so the
// originating card can reflect its own job.

const bridge = window.paperBridge;
const frame = document.getElementById("report-frame");
const select = document.getElementById("report-select");
const jobListEl = document.getElementById("job-list");
const jobEmptyEl = document.getElementById("job-empty");
const envBadge = document.getElementById("env-badge");

// jobId -> { el, data }
const rows = new Map();

// ---- report navigation ----
async function loadReports() {
  let reports = [];
  try {
    reports = await (await fetch("site/reports.json")).json();
  } catch (e) {
    console.error("[renderer] reports.json load failed:", e);
  }
  select.innerHTML = "";
  reports.forEach((f) => {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f.replace(".html", "").replace(/_/g, "-");
    select.appendChild(o);
  });
  if (reports.length) setReport(reports[0]);
}
function setReport(file) {
  frame.src = `site/daily_html/${file}`;
  document.title = `PaperReader · ${file.replace(".html", "").replace(/_/g, "-")}`;
}
select.addEventListener("change", () => setReport(select.value));
document.getElementById("btn-settings").addEventListener("click", () => bridge.openSettings());
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

function makeRow(evt) {
  const el = document.createElement("div");
  el.className = "job";
  el.innerHTML = `
    <div class="job-title"></div>
    <div class="job-meta"><span class="job-phase"></span><span class="job-elapsed"></span></div>
    <div class="job-bar"><i></i></div>
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
