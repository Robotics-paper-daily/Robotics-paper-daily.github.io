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

// Pin the app name so userData (config.json, site-cache) is deterministic —
// otherwise packaged vs `electron .` runs can resolve to different folders
// (PaperReader vs paperreader) and settings appear to "reset".
app.setName("PaperReader");

const APP_DIR = __dirname;
const SITE_DIR = path.join(APP_DIR, "site");

let mainWindow = null;
let settingsWindow = null;
let queue = null;

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
  return rel === "site/reports.json" || /^site\/daily_html\/[^/]+\.html$/.test(rel);
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
async function serveSiteLive(rel) {
  const sub = rel.slice("site/".length); // reports.json | daily_html/x.html
  const isHtml = /\.html?$/i.test(sub);
  const base = liveBase();
  const cacheFile = path.join(app.getPath("userData"), "site-cache", sub);
  const bundled = path.join(APP_DIR, rel);

  if (base) {
    try {
      const res = await net.fetch(base + "/" + sub, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        let body = Buffer.from(await res.arrayBuffer());
        if (isHtml) body = injectReadScript(body);
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, body);
        } catch {}
        return new Response(body, { headers: { "content-type": guessType(sub) } });
      }
    } catch {
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
    try {
      rel = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response("bad url", { status: 400 });
    }
    rel = rel.replace(/^\/+/, "");
    const filePath = path.normalize(path.join(APP_DIR, rel));
    if (!filePath.startsWith(APP_DIR)) return new Response("forbidden", { status: 403 });
    if (rel.startsWith("site/") && isLiveData(rel)) return serveSiteLive(rel);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

// In dev (unpacked), make sure app/site exists by snapshotting the sibling repo.
// In a packaged build the snapshot is bundled, so this is a no-op.
function ensureSite() {
  if (fs.existsSync(path.join(SITE_DIR, "reports.json"))) return;
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
    },
  });
  mainWindow.loadURL("app://local/shell.html");
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
          if (process.env.PAPERREADER_SMOKE_CLICK) {
            const clicked = await wc.executeJavaScript(
              `(() => { const d = document.getElementById('report-frame').contentWindow.document; const b = d.querySelector('.read-btn'); if (b) b.click(); return !!b; })()`
            );
            console.log("[smoke] clicked first read button:", clicked);
            await delay(22000); // let init + a phase or two stream in
            console.log("[smoke] after-click:", JSON.stringify(await wc.executeJavaScript(PROBE)));
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
    const dup = queue.findActiveByUrl(payload.url);
    if (dup) return { ok: false, reason: "already-running", jobId: dup.id };
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

  ipcMain.handle("settings:get", () => settings.load());
  ipcMain.handle("settings:set", (_e, patch) => settings.merge(patch));
  ipcMain.handle("env:probe", () => probeEnv(settings.load()));
  ipcMain.handle("settings:open", () => {
    createSettingsWindow();
    return { ok: true };
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
