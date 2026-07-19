// PaperReader — Electron main process.
//
// Serves the bundled static site (app/site) and the app shell over a custom
// `app://` scheme so the shell window and the report iframe share one origin
// (file:// would make them cross-origin opaque, breaking window.top access and
// fetch). Spawns the local `claude` CLI per "帮我读" click via the JobQueue,
// streams progress to the renderer.

const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const settings = require("./settings");
const { probeEnv, detectDefaults } = require("./env-probe");
const { JobQueue } = require("./job-queue");
const { syncSite } = require("./sync-site");
const { scanReadPapers } = require("./vault-scan");
const { setReadInNoteText } = require("./read-status");
const { arxivIdFromInput, parseArxivAtom } = require("./arxiv-meta");

// Pin the app name so userData (config.json, site-cache) is deterministic —
// otherwise packaged vs `electron .` runs can resolve to different folders
// (PaperReader vs paperreader) and settings appear to "reset".
app.setName("PaperReader");

const APP_DIR = __dirname;
const SITE_DIR = path.join(APP_DIR, "site");

let mainWindow = null;
let settingsWindow = null;
let queue = null;
let searchLiveRetryAfter = 0;

const SEARCH_LIVE_RETRY_DELAY_MS = 15000;

// ----- custom app:// scheme (same-origin for shell + report iframe) -----
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const LIVE_DEFAULT = "https://robotics-paper-daily.github.io";

function liveBase() {
  const s = settings.load();
  const b = s.liveBase !== undefined ? s.liveBase : LIVE_DEFAULT;
  return (b || "").replace(/\/$/, "");
}

// Only the daily *data* is pulled live (so the app always shows the latest
// papers without a git pull). The app's own code + the Zotero secrets stay
// local/bundled — we never fetch those from the public site.
function isLiveData(rel) {
  return (
    rel === "site/reports.json" ||
    rel === "site/search_index.json" ||
    /^site\/search_index\/(?:manifest|\d{4}-\d{2}(?:-\d{3})?)\.json$/.test(rel) ||
    /^site\/daily_html\/[^/]+\.html$/.test(rel)
  );
}

function guessType(p) {
  if (/\.html?$/i.test(p)) return "text/html; charset=utf-8";
  if (/\.json$/i.test(p)) return "application/json; charset=utf-8";
  if (/\.js$/i.test(p)) return "text/javascript; charset=utf-8";
  if (/\.css$/i.test(p)) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

// The public pages don't carry the read button (it's the app's addition). Make
// sure read-paper.js is loaded so it can inject the button in app mode.
function injectReadScript(buf) {
  let html = buf.toString("utf8");
  if (!/read-paper\.js/.test(html)) {
    html = html.replace(/<\/body>/i, '<script src="../js/read-paper.js"></script>\n</body>');
  }
  return Buffer.from(html, "utf8");
}

// Live-first for daily data: fetch GitHub Pages, cache to userData, fall back to
// that cache then the bundled snapshot when offline.
async function serveSiteLive(rel, requestSearch = "") {
  const sub = rel.slice("site/".length); // reports.json | daily_html/x.html
  const isHtml = /\.html?$/i.test(sub);
  const isSearchData = sub === "search_index.json" || sub.startsWith("search_index/");
  const isLegacySearch = sub === "search_index.json";
  const base = liveBase();
  const cacheFile = path.join(app.getPath("userData"), "site-cache", sub);
  const bundled = path.join(APP_DIR, rel);

  const canTryLive = base && (!isSearchData || isLegacySearch || Date.now() >= searchLiveRetryAfter);
  if (canTryLive) {
    try {
      // Search data can be tens of MB; give both legacy and sharded files more time.
      const timeoutMs = sub === "search_index/manifest.json"
        ? 10000
        : isSearchData && Date.now() < searchLiveRetryAfter
          ? 10000
          : isSearchData
            ? 120000
            : 6000;
      const res = await net.fetch(base + "/" + sub + requestSearch, {
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        if (isSearchData) searchLiveRetryAfter = 0;
        let body = Buffer.from(await res.arrayBuffer());
        if (isHtml) body = injectReadScript(body);
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, body);
        } catch {}
        return new Response(body, { headers: { "content-type": guessType(sub) } });
      }
      if (isSearchData) searchLiveRetryAfter = Date.now() + SEARCH_LIVE_RETRY_DELAY_MS;
    } catch {
      if (isSearchData) searchLiveRetryAfter = Date.now() + SEARCH_LIVE_RETRY_DELAY_MS;
      /* offline / error → fall through to cache/bundle */
    }
  }
  for (const f of [cacheFile, bundled]) {
    try {
      if (fs.existsSync(f)) {
        let body = fs.readFileSync(f);
        if (isHtml) body = injectReadScript(body); // idempotent
        return new Response(body, { headers: { "content-type": guessType(sub) } });
      }
    } catch {}
  }
  return new Response("not found", { status: 404 });
}

function registerAppProtocol() {
  protocol.handle("app", (request) => {
    let rel;
    let requestUrl;
    try {
      requestUrl = new URL(request.url);
      rel = decodeURIComponent(requestUrl.pathname);
    } catch {
      return new Response("bad url", { status: 400 });
    }
    rel = rel.replace(/^\/+/, "");
    const filePath = path.normalize(path.join(APP_DIR, rel));
    if (!filePath.startsWith(APP_DIR)) return new Response("forbidden", { status: 403 });
    if (rel.startsWith("site/") && isLiveData(rel)) return serveSiteLive(rel, requestUrl.search);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

// In dev (unpacked), make sure app/site exists by snapshotting the sibling repo.
// In a packaged build the snapshot is bundled, so this is a no-op.
function ensureSite() {
  const requiredSnapshotFiles = [
    path.join(SITE_DIR, "reports.json"),
    path.join(SITE_DIR, "js", "search-index.js"),
  ];
  if (requiredSnapshotFiles.every((file) => fs.existsSync(file))) return;
  try {
    syncSite(path.join(APP_DIR, ".."), SITE_DIR);
  } catch (e) {
    console.error("[main] site sync failed:", e);
  }
}

// Fill empty vault/claude paths from detected defaults on first run.
function firstRunInit() {
  let s = settings.load();
  if (s.vaultPath && s.claudePath) return s;
  const d = detectDefaults();
  const patch = {};
  if (!s.vaultPath && d.vaultPath) patch.vaultPath = d.vaultPath;
  if (!s.claudePath && d.claudePath) patch.claudePath = d.claudePath;
  return Object.keys(patch).length ? settings.merge(patch) : s;
}

// http(s) URLs (links / window.open from the report iframe or a webview) →
// in-app tab; the renderer builds the <webview>. Other schemes → the OS. Always
// denies the native popup so we never spawn extra windows.
function routeOpenUrl(url) {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("open-tab", url);
  } else if (url) {
    shell.openExternal(url).catch(() => {});
  }
  return { action: "deny" };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "PaperReader",
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(APP_DIR, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true, // external links open as in-app <webview> tabs
    },
  });
  mainWindow.loadURL("app://local/shell.html");

  // Route window.open / target=_blank (from the report iframe) to in-app tabs
  // instead of native windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => routeOpenUrl(url));
  // Harden the <webview> guests: no preload, no node integration.
  mainWindow.webContents.on("will-attach-webview", (_e, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Headless smoke test: PAPERREADER_SMOKE=<png path> captures the rendered
  // window (shell + report iframe + read buttons) after load, then quits.
  if (process.env.PAPERREADER_SMOKE) {
    mainWindow.webContents.once("did-finish-load", () => {
      (async () => {
        const wc = mainWindow.webContents;
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));
        const PROBE = `(() => {
            const f = document.getElementById('report-frame');
            const w = f && f.contentWindow;
            const d = w && w.document;
            if (!d) return { error: 'no iframe doc' };
            const btn = d.querySelector('.read-btn');
            const cs = btn ? w.getComputedStyle(btn) : null;
            const sb = document.querySelector('#job-list .job');
            return {
              iframeSrc: (f.getAttribute('src')||'').split('/').pop(),
              appMode: d.body.classList.contains('app-mode'),
              readBtnCount: d.querySelectorAll('.read-btn').length,
              readMarkedCount: d.querySelectorAll('.read-btn.read').length,
              firstBtnDisplay: cs ? cs.display : null,
              firstBtnState: btn ? btn.dataset.state : null,
              firstBtnLabel: btn ? (btn.querySelector('.read-label')||btn).textContent.replace(/\\s+/g,' ').trim() : null,
              sidebarPhase: sb ? (sb.querySelector('.job-phase')||{}).textContent : null,
              bridgeViaTop: (()=>{ try { return typeof w.top.paperBridge; } catch(e){ return 'throw:'+e.name; } })(),
            };
          })()`;
        try {
          await delay(2500);
          const gate = await wc.executeJavaScript(
            `(() => { const o = document.getElementById('unlock-overlay'); return { unlockVisible: !!o && getComputedStyle(o).display !== 'none', hasBundle: !!window.__ZOTERO_ENC }; })()`
          );
          console.log("[smoke] gate:", JSON.stringify(gate));
          if (gate.unlockVisible) {
            const g = await wc.capturePage();
            fs.writeFileSync(process.env.PAPERREADER_SMOKE.replace(/\.png$/, ".gate.png"), g.toPNG());
          }
          // smoke runs guest-mode: skip the unlock so the report loads
          await wc.executeJavaScript(
            `(() => { const o = document.getElementById('unlock-overlay'); const b = document.getElementById('unlock-skip'); if (b && o && getComputedStyle(o).display !== 'none') b.click(); })()`
          );
          await delay(4500);
          console.log("[smoke] probe:", JSON.stringify(await wc.executeJavaScript(PROBE)));
          // New chrome (refresh / calendar popover / search panel) sanity probe.
          if (process.env.PAPERREADER_SMOKE_UI) {
            const ui = await wc.executeJavaScript(`(() => {
                const out = {};
                out.calendarLoaded = typeof window.PRCalendar !== 'undefined';
                out.miniSearchLoaded = typeof window.MiniSearch !== 'undefined';
                out.zoteroSaveLoaded = typeof window.ZoteroSave !== 'undefined';
                out.hasSearchBtn = !!document.getElementById('btn-search');
                out.hasRefreshBtn = !!document.getElementById('btn-refresh');
                const pill = document.getElementById('date-pill-btn'); if (pill) pill.click();
                const pop = document.getElementById('date-popover');
                out.calOpen = !!pop && pop.classList.contains('open');
                out.calReportDays = document.querySelectorAll('#date-popover .dp-cell.has, #date-popover .dp-cell.sel').length;
                out.calTitle = (document.querySelector('#date-popover .dp-title')||{}).textContent || null;
                if (pill) pill.click();
                const sb = document.getElementById('btn-search'); if (sb) sb.click();
                const so = document.getElementById('search-overlay');
                out.searchOpen = !!so && getComputedStyle(so).display !== 'none';
                out.hasSearchInput = !!document.getElementById('search-input');
                const sc = document.getElementById('search-close'); if (sc) sc.click();
                return out;
              })()`);
            console.log("[smoke] ui:", JSON.stringify(ui));
          }
          // Render a synthetic finished job through the real IPC path to verify
          // the frozen total time + per-read token line render.
          if (process.env.PAPERREADER_SMOKE_TOKENS) {
            const fake = {
              jobId: "job_smoke",
              title: "SMOKE token render test",
              state: "done",
              phase: "done",
              label: "已生成",
              startedAt: Date.now() - 154000,
              durationMs: 154000,
              usage: { input: 2100, output: 48000, cacheRead: 1200000, cacheCreate: 30000 },
              costUsd: 3.4,
            };
            mainWindow.webContents.send("paper:progress", fake);
            await delay(600);
            const row = await wc.executeJavaScript(`(() => {
                const j = document.querySelector('#job-list .job');
                if (!j) return { found: false };
                const tk = j.querySelector('.job-tokens');
                return {
                  found: true,
                  phase: (j.querySelector('.job-phase')||{}).textContent,
                  elapsed: (j.querySelector('.job-elapsed')||{}).textContent,
                  tokens: tk ? tk.textContent : null,
                  tokensShown: !!(tk && getComputedStyle(tk).display !== 'none'),
                };
              })()`);
            console.log("[smoke] tokens:", JSON.stringify(row));
          }
          // Click the FIRST IDLE 帮我读 (skip 已读/已生成/读取中/失败) so we actually
          // spawn a read — clicking a 已读 button would only open its note.
          const PICK_IDLE = `(() => {
              const d = document.getElementById('report-frame').contentWindow.document;
              const b = d.querySelector('.read-btn:not(.read):not(.done):not(.running):not(.error)') || d.querySelector('.read-btn');
              if (!b) return { ok: false };
              b.click();
              return { ok: true, idx: b.dataset.paperIndex, label: (b.querySelector('.read-label')||b).textContent.replace(/\\s+/g,' ').trim() };
            })()`;
          if (process.env.PAPERREADER_SMOKE_CLICK) {
            console.log("[smoke] clicked idle read button:", JSON.stringify(await wc.executeJavaScript(PICK_IDLE)));
            await delay(22000); // let init + a phase or two stream in
            console.log("[smoke] after-click:", JSON.stringify(await wc.executeJavaScript(PROBE)));
          }
          // Full end-to-end: spawn a real read, poll the JobQueue (main process)
          // to completion, then exercise openInObsidian — automated e2e check.
          if (process.env.PAPERREADER_SMOKE_FULL) {
            console.log("[smoke] full-read clicked:", JSON.stringify(await wc.executeJavaScript(PICK_IDLE)));
            const deadline = Date.now() + 18 * 60 * 1000; // under the 20-min watchdog
            let job = null, lastKey = "";
            while (Date.now() < deadline) {
              await delay(5000);
              const snap = queue.snapshot();
              job = snap.length ? snap[snap.length - 1] : null;
              if (job) {
                const key = `${job.state}/${job.phase}/${job.label}`;
                if (key !== lastKey) {
                  console.log("[smoke] job:", JSON.stringify({ state: job.state, phase: job.phase, label: job.label }));
                  lastKey = key;
                }
                if (job.state === "done" || job.state === "error") break;
              }
            }
            console.log("[smoke] final job:", JSON.stringify(job));
            if (job && job.state === "done") {
              console.log("[smoke] folderPath:", job.folderPath);
              console.log("[smoke] openInObsidian:", JSON.stringify(queue.openInObsidian(job.id)));
            }
          }
          // Verify in-app tabs: a window.open from the report must create a
          // background tab, NOT a native window.
          if (process.env.PAPERREADER_SMOKE_TAB) {
            await wc.executeJavaScript(
              `(() => { const f = document.getElementById('report-frame'); (f.contentWindow || window).open('https://example.com/','_blank'); return true; })()`
            );
            await delay(2000);
            const tabInfo = await wc.executeJavaScript(
              `(() => ({ tabs: document.querySelectorAll('#tabbar .tab').length, hasNew: !!document.querySelector('#tabbar .tab.has-new'), navHidden: document.getElementById('nav').classList.contains('view-hidden'), dateLabel: (document.getElementById('date-label')||{}).textContent, reportHidden: document.getElementById('report-frame').classList.contains('view-hidden') }))()`
            );
            console.log("[smoke] tabs:", JSON.stringify(tabInfo), "windows:", BrowserWindow.getAllWindows().length);
            console.log("[smoke] report-after-tab:", JSON.stringify(await wc.executeJavaScript(PROBE)));
          }
          const img = await wc.capturePage();
          fs.writeFileSync(process.env.PAPERREADER_SMOKE, img.toPNG());
          console.log("[smoke] captured to", process.env.PAPERREADER_SMOKE);
        } catch (e) {
          console.error("[smoke] failed:", e);
        }
        // never leave a real read running after a smoke test
        try {
          for (const j of queue.snapshot()) {
            if (j.state === "running" || j.state === "queued") {
              queue.cancel(j.id);
              console.log("[smoke] canceled", j.id);
            }
          }
        } catch {}
        await delay(1200);
        app.quit();
      })();
    });
  }
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 560,
    title: "PaperReader 设置",
    parent: mainWindow || undefined,
    modal: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(APP_DIR, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (settingsWindow.removeMenu) settingsWindow.removeMenu();
  settingsWindow.loadURL("app://local/settings.html");
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

// ----- IPC -----
function wireIpc() {
  ipcMain.handle("paper:read", (_e, payload) => {
    const probe = probeEnv(settings.load());
    if (!probe.ready) {
      createSettingsWindow();
      return { ok: false, reason: !probe.claude.ok ? "claude 未就绪" : "vault 未就绪" };
    }
    if (payload.url) {
      const dup = queue.findActiveByUrl(payload.url);
      if (dup) return { ok: false, reason: "already-running", jobId: dup.id };
    }
    const job = queue.enqueue(payload);
    return { ok: true, jobId: job.id, state: job.state };
  });

  ipcMain.handle("paper:cancel", (_e, jobId) => queue.cancel(jobId));
  ipcMain.handle("job:list", () => queue.snapshot());
  ipcMain.handle("job:openFolder", (_e, jobId) => queue.openFolder(jobId));
  ipcMain.handle("job:openInObsidian", (_e, jobId) => queue.openInObsidian(jobId));

  // Already-read indicator: scan the local vault for existing notes, and open one.
  ipcMain.handle("vault:readPapers", () => scanReadPapers(settings.load().vaultPath));
  ipcMain.handle("vault:openNote", (_e, relNoExt) => {
    const s = settings.load();
    if (!s.vaultPath || !relNoExt) return { ok: false, reason: "no-path" };
    const vaultName = path.basename(s.vaultPath);
    const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(relNoExt)}`;
    shell.openExternal(uri);
    return { ok: true, uri };
  });

  // Manual 已读: flip the checkbox at the end of the note's .md (syncs via Obsidian).
  ipcMain.handle("vault:setReadStatus", (_e, relNoExt, read) => {
    const s = settings.load();
    if (!s.vaultPath || !relNoExt) return { ok: false, reason: "no-path" };
    const notePath = path.join(s.vaultPath, relNoExt + ".md");
    try {
      const text = fs.readFileSync(notePath, "utf8");
      const next = setReadInNoteText(text, !!read);
      if (next !== text) fs.writeFileSync(notePath, next, "utf8");
      return { ok: true, read: !!read };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  });

  ipcMain.handle("settings:get", () => settings.load());
  ipcMain.handle("settings:set", (_e, patch) => settings.merge(patch));
  ipcMain.handle("env:probe", () => probeEnv(settings.load()));
  ipcMain.handle("settings:open", () => {
    createSettingsWindow();
    return { ok: true };
  });

  // "Open in system browser" from a web tab's nav row.
  ipcMain.handle("open-external", (_e, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) shell.openExternal(url);
    return { ok: true };
  });

  // Fetch arXiv metadata for a link/ID (read-modal "加入 Zotero"). Done in the
  // main process via net.fetch — the arXiv Atom API sets no CORS headers.
  ipcMain.handle("arxiv:meta", async (_e, idOrUrl) => {
    const id = arxivIdFromInput(idOrUrl);
    if (!id) return { ok: false, reason: "无法识别 arXiv ID" };
    try {
      const res = await net.fetch(
        `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) return { ok: false, reason: `arXiv HTTP ${res.status}` };
      const meta = parseArxivAtom(await res.text(), id);
      if (!meta) return { ok: false, reason: "未找到该论文（或解析失败）" };
      return { ok: true, id, meta };
    } catch (e) {
      return { ok: false, reason: e.message || String(e) };
    }
  });

  ipcMain.handle("settings:pickVault", async () => {
    const r = await dialog.showOpenDialog(settingsWindow || mainWindow, {
      properties: ["openDirectory"],
      title: "选择 Obsidian vault（含 paper-reading 技能）",
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("settings:pickClaude", async () => {
    const r = await dialog.showOpenDialog(settingsWindow || mainWindow, {
      properties: ["openFile"],
      title: "选择 claude 可执行文件",
    });
    return r.canceled ? null : r.filePaths[0];
  });
}

app.whenReady().then(() => {
  // Dev (`electron .`) otherwise shows the default Electron dock icon; use ours.
  // Packaged builds get the icon from the .app bundle, so only override in dev.
  if (!app.isPackaged && process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(path.join(APP_DIR, "build", "icon.png"));
    } catch {}
  }
  registerAppProtocol();
  ensureSite();
  firstRunInit();

  queue = new JobQueue({
    settings: () => settings.load(),
    onProgress: (evt) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("paper:progress", evt);
      }
    },
  });

  wireIpc();
  createMainWindow();

  // <webview> guests: route their popups (in-page links opening new windows) to
  // in-app tabs as well, so nothing ever spawns a native window.
  app.on("web-contents-created", (_e, contents) => {
    if (typeof contents.getType === "function" && contents.getType() === "webview") {
      contents.setWindowOpenHandler(({ url }) => routeOpenUrl(url));
    }
  });

  // If prerequisites are missing, surface settings right away.
  const probe = probeEnv(settings.load());
  if (!probe.ready) createSettingsWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
