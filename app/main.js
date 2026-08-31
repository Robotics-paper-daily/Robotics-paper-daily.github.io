// PaperReader — Electron main process.
//
// Serves the bundled static site (app/site) and the app shell over a custom
// `app://` scheme. Live reports run in a unique-origin sandbox and reach the
// shell only through a narrow postMessage RPC. Spawns the selected local AI CLI
// per "帮我读" click via the JobQueue and streams progress to the renderer.

const { app, BrowserWindow, ipcMain, dialog, protocol, net, safeStorage, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const settings = require("./settings");
const { JobQueue } = require("./job-queue");
const { syncSite } = require("./sync-site");
const { runBackgroundTask } = require("./background-task");
const { setReadInNoteText } = require("./read-status");
const { arxivIdFromInput, parseArxivAtom } = require("./arxiv-meta");
const { saveArxivPdf, verifySavedPdf } = require("./zotero-linked-store");
const { verifyOneDriveCloudFile } = require("./onedrive-cloud-verify");
const { readZoteroBaseAttachmentPath } = require("./zotero-profile");
const { classifyOpenUrl } = require("./url-routing");
const { isAllowedReportFrameUrl, prepareAppReportHtml } = require("./report-sandbox");
const { ReportGestureGate, wireReportGestureInput } = require("./report-gesture");
const { createZoteroCredentialStore } = require("./zotero-credentials");
const { verifyZoteroApiKey } = require("./zotero-key-verify");
const { ZoteroPdfQueue } = require("./zotero-pdf-queue");

// Pin the app name so userData (config.json, site-cache) is deterministic —
// otherwise packaged vs `electron .` runs can resolve to different folders
// (PaperReader vs paperreader) and settings appear to "reset".
app.setName("PaperReader");

const APP_DIR = __dirname;
const SITE_DIR = path.join(APP_DIR, "site");

let mainWindow = null;
let settingsWindow = null;
let queue = null;
let zoteroCredentialStore = null;
let searchLiveRetryAfter = 0;
let initialSettingsReady = Promise.resolve();
let startupMaintenanceReady = Promise.resolve();
let envProbeCache = null;
let vaultScanCache = null;
let paperCacheDir = null;
const zoteroPdfWrites = new ZoteroPdfQueue();
const reportGestureGate = new ReportGestureGate();

const SEARCH_LIVE_RETRY_DELAY_MS = 15000;
const ENV_PROBE_TTL_MS = 60_000;
const VAULT_SCAN_TTL_MS = 30_000;

function cachedBackgroundTask(cacheName, key, task, payload, ttlMs, force = false) {
  const current = cacheName === "env" ? envProbeCache : vaultScanCache;
  if (current && current.key === key) {
    if (current.promise) return current.promise;
    if (!force && Date.now() - current.at < ttlMs) return Promise.resolve(current.value);
  }

  const entry = { key, at: 0, value: null, promise: null };
  const pending = runBackgroundTask(task, payload)
    .then((value) => {
      entry.at = Date.now();
      entry.value = value;
      entry.promise = null;
      return value;
    })
    .catch((error) => {
      if (cacheName === "env" && envProbeCache === entry) envProbeCache = null;
      if (cacheName === "vault" && vaultScanCache === entry) vaultScanCache = null;
      throw error;
    });
  entry.promise = pending;
  if (cacheName === "env") envProbeCache = entry;
  else vaultScanCache = entry;
  return pending;
}

function probeEnvironment(current, options = {}) {
  // The cache path is derived by the trusted main process, never by a report or
  // settings payload. Include it only in the worker snapshot so environment
  // preflight can reject a vault that overlaps App userData before a job starts.
  const snapshot = { ...(current || {}), __paperCacheDir: paperCacheDir || "" };
  return cachedBackgroundTask(
    "env",
    JSON.stringify(snapshot),
    "probeEnv",
    snapshot,
    ENV_PROBE_TTL_MS,
    options.force === true
  );
}

function readPapersInBackground(vaultPath, options = {}) {
  const key = typeof vaultPath === "string" ? vaultPath : "";
  return cachedBackgroundTask(
    "vault",
    key,
    "scanReadPapers",
    { vaultPath: key },
    VAULT_SCAN_TTL_MS,
    options.force === true
  );
}

function invalidateEnvironmentCaches() {
  envProbeCache = null;
  vaultScanCache = null;
}

function preparePaperCacheDir() {
  const cacheDir = path.join(app.getPath("userData"), "paper-cache");
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(cacheDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("paper-cache is not a safe directory");
  }
  return cacheDir;
}

function linkedPdfErrorReason(error) {
  const code = error && error.code;
  const messages = {
    INVALID_ROOT: "请先在设置中选择与 Zotero 完全一致的链接附件基准目录",
    ZOTERO_PROFILE_UNAVAILABLE: "无法读取 Zotero 当前配置，请确认 Zotero 已安装并配置链接附件基准目录",
    ZOTERO_BASE_UNAVAILABLE: "Zotero 尚未配置 Linked Attachment Base Directory",
    ZOTERO_ROOT_MISMATCH: "PaperReader 目录与 Zotero 的 Linked Attachment Base Directory 不一致，已停止写入",
    INVALID_URL: "仅支持标准的 arXiv PDF 链接",
    HTTP_ERROR: "arXiv PDF 下载失败",
    NOT_PDF: "arXiv 返回的内容不是有效 PDF",
    TOO_LARGE: "PDF 超过 100 MiB 安全上限",
    DOWNLOAD_ABORTED: "PDF 下载超时或已取消",
    DOWNLOAD_INTERRUPTED: "PDF 下载中断，请检查网络后重试",
    UNSAFE_EXISTING_FILE: "目标文件是链接或非普通文件，为避免覆盖已停止",
    DESTINATION_UNAVAILABLE: "无法检查 OneDrive 中的现有附件",
    COMMIT_FAILED: "无法安全写入 OneDrive 链接附件目录",
    CONFIRMATION_TIMEOUT: "等待 OneDrive 云端上传确认超时，请检查同步状态后重试",
    FILE_PROVIDER_COMMAND_FAILED: "无法读取 OneDrive File Provider 状态",
    FILE_NOT_ACCESSIBLE: "OneDrive 中的附件文件不可访问",
    SYMLINK_NOT_ALLOWED: "OneDrive 附件不能是符号链接",
    NOT_REGULAR_FILE: "OneDrive 附件不是普通文件",
    ABORTED: "等待 OneDrive 云端确认时已取消",
    SAVED_FILE_MISSING: "OneDrive 云端确认后，本地附件已不存在",
    SAVED_FILE_CHANGED: "OneDrive 云端确认后，附件内容发生变化",
    CLOUD_CONFIRM_UNAVAILABLE: "当前系统无法可靠确认 OneDrive 云端提交，已停止创建 Zotero 元数据",
  };
  return messages[code] || ((error && error.message) || String(error));
}

function resolveMacOneDriveRoot(configuredRoot) {
  if (process.platform !== "darwin") {
    const error = new Error("OneDrive cloud confirmation is unavailable on this platform");
    error.code = "CLOUD_CONFIRM_UNAVAILABLE";
    throw error;
  }
  let realRoot;
  try {
    realRoot = fs.realpathSync(configuredRoot || "");
  } catch (cause) {
    const error = new Error("The configured OneDrive root is unavailable", { cause });
    error.code = "INVALID_ROOT";
    throw error;
  }
  const cloudStorage = path.join(app.getPath("home"), "Library", "CloudStorage");
  const relative = path.relative(cloudStorage, realRoot);
  const provider = relative.split(path.sep)[0];
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !/^OneDrive(?:-|$)/i.test(provider)
  ) {
    const error = new Error("The configured root is not inside a macOS OneDrive File Provider domain");
    error.code = "INVALID_ROOT";
    throw error;
  }
  return realRoot;
}

function resolveVerifiedZoteroRoot(configuredRoot) {
  const appRoot = resolveMacOneDriveRoot(configuredRoot);
  const zoteroConfigured = readZoteroBaseAttachmentPath({ homeDir: app.getPath("home") });
  const zoteroRoot = resolveMacOneDriveRoot(zoteroConfigured);
  if (appRoot !== zoteroRoot) {
    const error = new Error("PaperReader and Zotero attachment roots do not match");
    error.code = "ZOTERO_ROOT_MISMATCH";
    throw error;
  }
  return appRoot;
}

// ----- custom app:// scheme -----
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
// papers without a git pull). App code stays local/bundled and each user's
// Zotero key lives in the OS-protected local credential store.
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

function preparedReportResponse(raw, sub) {
  const prepared = prepareAppReportHtml(raw);
  return new Response(prepared.body, {
    headers: {
      "content-type": guessType(sub),
      "content-security-policy": prepared.csp,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
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
        const body = Buffer.from(await res.arrayBuffer());
        // Validate and harden before replacing a known-good cache entry. The
        // cache stores raw data; every response receives a fresh CSP nonce.
        const reportResponse = isHtml ? preparedReportResponse(body, sub) : null;
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, body);
        } catch {}
        return reportResponse || new Response(body, { headers: { "content-type": guessType(sub) } });
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
        const body = fs.readFileSync(f);
        return isHtml
          ? preparedReportResponse(body, sub)
          : new Response(body, { headers: { "content-type": guessType(sub) } });
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
    const appRelative = path.relative(APP_DIR, filePath);
    if (
      !appRelative ||
      appRelative === ".." ||
      appRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(appRelative)
    ) {
      return new Response("forbidden", { status: 403 });
    }
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
  if (app.isPackaged && requiredSnapshotFiles.every((file) => fs.existsSync(file))) return;
  try {
    syncSite(path.join(APP_DIR, ".."), SITE_DIR);
  } catch (e) {
    console.error("[main] site sync failed:", e);
  }
}

// Fill empty vault/CLI paths from detected defaults on first run. Discovery can
// invoke login shells, so it runs in a worker while the main window is already
// free to paint and process input.
async function firstRunInit() {
  let s = settings.load();
  let d = {};
  const chooseFreshProvider = !settings.providerConfigured();
  const selectedCliMissing = s.provider === "codex"
    ? !s.codexPath
    : s.provider === "claude"
      ? !s.claudePath
      : !s.traePath;
  if (!s.vaultPath || selectedCliMissing || chooseFreshProvider) {
    try {
      d = await runBackgroundTask("detectDefaults");
    } catch (error) {
      console.error("[main] default environment detection failed:", error && error.message);
    }
  }
  const patch = {};
  if (chooseFreshProvider) {
    // Prefer the public Codex path, then Claude, and use Trae only when it is
    // the sole detected provider. With none installed, keep Codex as the
    // documented onboarding default. Explicit existing choices are untouched.
    patch.provider = d.codexPath
      ? "codex"
      : d.claudePath
        ? "claude"
        : d.traePath
          ? "trae"
          : "codex";
  }
  if (!s.vaultPath && d.vaultPath) patch.vaultPath = d.vaultPath;
  if (!s.codexPath && d.codexPath) patch.codexPath = d.codexPath;
  if (!s.claudePath && d.claudePath) patch.claudePath = d.claudePath;
  if (!s.traePath && d.traePath) patch.traePath = d.traePath;
  if (!s.zoteroLinkedAttachmentRoot && process.platform === "darwin") {
    try {
      const detected = readZoteroBaseAttachmentPath({ homeDir: app.getPath("home") });
      patch.zoteroLinkedAttachmentRoot = resolveMacOneDriveRoot(detected);
    } catch {
      // Zotero/OneDrive is optional; Settings will show an actionable status.
    }
  }
  if (!Object.keys(patch).length) return s;
  try {
    const merged = settings.merge(patch);
    invalidateEnvironmentCaches();
    return merged;
  } catch (e) {
    console.error("[main] first-run settings init failed:", e);
    return s;
  }
}

// http(s) URLs (links / window.open from the report iframe or a webview) go to
// an in-app tab. Custom/file schemes fail closed: an untrusted report must not
// launch or write through OS protocol handlers. Trusted Obsidian actions use
// their dedicated, validated IPC paths instead.
function routeOpenUrl(url) {
  if (classifyOpenUrl(url) === "web") {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("open-tab", url);
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

  // A preload remains attached if a top-level page navigates. Keep the
  // privileged bridge confined to our immutable shell and route external
  // navigation through the existing in-app browser path.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === "app://local/shell.html") return;
    event.preventDefault();
    routeOpenUrl(url);
  });

  // A direct report WindowProxy is part of the RPC caller check. Do not let
  // that browsing context navigate to an arbitrary opaque-origin page and
  // retain the same identity. Date changes are the only allowed subframe
  // navigation and invalidate any pending physical-input grant.
  mainWindow.webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame) return;
    const parent = details.frame && details.frame.parent;
    if (parent && parent.url === "app://local/shell.html" && isAllowedReportFrameUrl(details.url)) {
      reportGestureGate.reset();
      return;
    }
    details.preventDefault();
  });

  // These events originate below the renderer's JavaScript event-dispatch
  // layer. Programmatic `.click()` therefore cannot mint a gesture, and the
  // gate consumes at most one privileged report action per physical input.
  wireReportGestureInput(mainWindow.webContents, reportGestureGate);

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
    reportGestureGate.reset();
    mainWindow = null;
  });

  // Headless smoke test: PAPERREADER_SMOKE=<png path> captures the rendered
  // window (shell + report iframe + read buttons) after load, then quits.
  if (process.env.PAPERREADER_SMOKE) {
    mainWindow.webContents.once("did-finish-load", () => {
      (async () => {
        const wc = mainWindow.webContents;
        let reportFrame = null;
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));
        const PROBE = `(() => {
            const f = document.getElementById('report-frame');
            const sb = document.querySelector('#job-list .job');
            return {
              iframeSrc: f ? (f.getAttribute('src')||'').split('/').pop() : null,
              sandbox: f ? f.getAttribute('sandbox') : null,
              reportReady: !!(f && f.dataset.reportReady === 'true'),
              sidebarPhase: sb ? (sb.querySelector('.job-phase')||{}).textContent : null,
              privilegedBridgeInMainFrame: typeof window.paperBridge,
            };
          })()`;
        try {
          await delay(2500);
          await delay(4500);
          console.log("[smoke] probe:", JSON.stringify(await wc.executeJavaScript(PROBE)));
          reportFrame = wc.mainFrame.frames.find((candidate) =>
            /\/site\/daily_html\/[^/]+\.html(?:\?|$)/.test(candidate.url || "")
          );
          if (reportFrame) {
            const sandboxProbe = await reportFrame.executeJavaScript(`(() => {
                const blocked = (read) => {
                  try { return read(); } catch (error) { return 'blocked:' + error.name; }
                };
                return {
                  serializedOrigin: location.origin,
                  preloadBridge: typeof window.paperBridge,
                  rpcReady: !!window.PaperReaderReportBridge,
                  remoteCode: {
                    tailwind: typeof window.tailwind,
                    framerMotion: typeof window.Motion,
                    sparkMd5: typeof window.SparkMD5,
                    jsZip: typeof window.JSZip,
                  },
                  parentBridge: blocked(() => typeof window.parent.paperBridge),
                  parentDocument: blocked(() => typeof window.parent.document.body),
                };
              })()`);
            console.log("[smoke] sandbox:", JSON.stringify(sandboxProbe));
            const rpcProbe = await reportFrame.executeJavaScript(`(async () => {
                const bridge = window.PaperReaderReportBridge;
                const jobs = await bridge.listJobs();
                let forbidden = null;
                let noGesture = null;
                try {
                  await bridge.request('settings:get', {});
                } catch (error) {
                  forbidden = error && error.message;
                }
                try {
                  await bridge.request('zotero:add', {
                    reportFile: location.pathname.split('/').pop(),
                    paper: {
                      title: 'Gesture smoke probe',
                      summary: '',
                      url: 'https://arxiv.org/abs/2608.01201v1',
                      authors: [],
                      keywords: [],
                      date: '2026-08-10',
                    },
                  });
                } catch (error) {
                  noGesture = { code: error && error.code, message: error && error.message };
                }
                return { jobCount: Array.isArray(jobs) ? jobs.length : null, forbidden, noGesture };
              })()`);
            console.log("[smoke] report-rpc:", JSON.stringify(rpcProbe));
            const beforeNavigationUrl = reportFrame.url;
            await reportFrame.executeJavaScript(
              `location.href = 'https://example.com/paperreader-report-escape-probe'`
            );
            await delay(250);
            console.log(
              "[smoke] report-navigation:",
              JSON.stringify({
                locked: reportFrame.url === beforeNavigationUrl,
                url: reportFrame.url,
              })
            );
          }
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
          // Optional linked-file IPC probe. Point this at an arXiv version that
          // already exists to exercise preload -> IPC -> Electron net.fetch ->
          // OneDrive verification without creating or overwriting a file.
          if (process.env.PAPERREADER_SMOKE_ZOTERO) {
            const source = JSON.stringify(process.env.PAPERREADER_SMOKE_ZOTERO);
            const linked = await wc.executeJavaScript(
              `window.paperBridge.zoteroWriteLinkedPdf({ sourceUrl: ${source} })`
            );
            console.log(
              "[smoke] zotero-linked:",
              JSON.stringify({
                ok: !!(linked && linked.ok),
                state: linked && linked.state,
                filename: linked && linked.filename,
                zoteroPath: linked && linked.zoteroPath,
                cloudConfirmed: linked && linked.cloudConfirmed,
                code: linked && linked.code,
              })
            );
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
          const PICK_IDLE = `(() => ({ ok: false, reason: 'sandboxed-report-use-manual-click' }))()`;
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
          // Verify report scroll is preserved across a tab switch: scroll the
          // report, open a background tab, switch to it and back home, then check
          // the report's inner scrollY was restored (regression guard for the
          // display:none scroll reset).
          if (process.env.PAPERREADER_SMOKE_SCROLL) {
            if (!reportFrame) throw new Error("report frame unavailable for scroll smoke");
            const before = await reportFrame.executeJavaScript(`(async () => {
                scrollTo(0, 600);
                await new Promise((resolve) => setTimeout(resolve, 150));
                return scrollY;
              })()`);
            // Exercise the report's real popup route without crossing the
            // unique-origin boundary from shell JavaScript.
            await reportFrame.executeJavaScript(
              `window.open('https://example.com/', '_blank'); true`
            );
            await delay(1500);
            await wc.executeJavaScript(`(() => {
                const firstTab = document.querySelector('#tabbar .tab:not(.home)');
                if (firstTab) firstTab.click();
                return !!firstTab;
              })()`);
            await delay(600);
            await wc.executeJavaScript(
              `document.getElementById('tab-home').click(); true`
            );
            await delay(600);
            const after = await reportFrame.executeJavaScript("scrollY");
            const res = { before, after, preserved: Math.abs(before - after) <= 2 };
            console.log("[smoke] scroll-preserve:", JSON.stringify(res));
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
    width: 640,
    height: 760,
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

function trustedAppPage(event, allowedUrls) {
  const frameUrl = (event && event.senderFrame && event.senderFrame.url) || "";
  return !!(
    event &&
    event.sender &&
    allowedUrls.includes(frameUrl) &&
    ((mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents) ||
      (settingsWindow && !settingsWindow.isDestroyed() && event.sender === settingsWindow.webContents))
  );
}

function zoteroCredentialReason(error) {
  const code = error && error.code;
  const reasons = {
    INVALID_API_KEY: "API key 应为 24 位字母或数字",
    AUTH_REJECTED: "Zotero 拒绝了这个 API key；请确认 key 未撤销",
    INSUFFICIENT_PERMISSIONS: "API key 必须允许个人文献库的读取和写入",
    REQUEST_ABORTED: "验证 Zotero API key 超时，请检查网络后重试",
    NETWORK_ERROR: "无法连接 Zotero API，请检查网络后重试",
    NETWORK_UNAVAILABLE: "当前环境无法连接 Zotero API",
    INVALID_RESPONSE: "Zotero 返回了无法识别的验证结果",
    SECURE_STORAGE_UNAVAILABLE: "系统安全存储不可用，PaperReader 不会明文保存 API key",
    INSECURE_STORAGE_BACKEND: "系统只提供明文凭据后端，PaperReader 已拒绝保存 API key",
  };
  return reasons[code] || "Zotero API key 验证或保存失败";
}

// ----- IPC -----
function wireIpc() {
  ipcMain.handle("paper:read", async (_e, payload) => {
    await initialSettingsReady;
    await startupMaintenanceReady;
    if (!paperCacheDir) {
      createSettingsWindow();
      return { ok: false, reason: "PaperReader 缓存目录不可用，请重启 App 后重试" };
    }
    let probe;
    try {
      probe = await probeEnvironment(settings.load());
    } catch (error) {
      console.error("[main] environment probe failed:", error && error.message);
      createSettingsWindow();
      return { ok: false, reason: "环境检测失败，请打开设置后重试" };
    }
    if (!probe.ready) {
      createSettingsWindow();
      const cliName = probe.provider === "codex"
        ? "Codex CLI"
        : probe.provider === "claude"
          ? "claude"
          : "Trae CLI";
      const reason = !probe.vault.ok
        ? probe.vault.reason || "vault 未就绪"
        : !probe.cli.ok
          ? probe.cli.reason || `${cliName} 未就绪`
          : probe.python && !probe.python.ok
            ? probe.python.reason
            : "环境未就绪";
      return { ok: false, reason };
    }
    if (payload.url) {
      const dup = queue.findActiveByUrl(payload.url);
      if (dup) return { ok: false, reason: "already-running", jobId: dup.id };
    }
    const job = queue.enqueue(payload, {
      pythonPath: probe.python && probe.python.path,
      pythonReadRoots: probe.python && probe.python.readRoots,
    });
    return { ok: true, jobId: job.id, state: job.state };
  });

  ipcMain.handle("paper:cancel", (_e, jobId) => queue.cancel(jobId));
  ipcMain.handle("job:list", () => queue.snapshot());
  ipcMain.handle("job:openFolder", (_e, jobId) => queue.openFolder(jobId));
  ipcMain.handle("job:openInObsidian", (_e, jobId) => queue.openInObsidian(jobId));

  // Already-read indicator: scan the local vault for existing notes, and open one.
  ipcMain.handle("vault:readPapers", async () => {
    await initialSettingsReady;
    return readPapersInBackground(settings.load().vaultPath);
  });
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
      vaultScanCache = null;
      return { ok: true, read: !!read };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  });

  ipcMain.handle("settings:get", async () => {
    await initialSettingsReady;
    return settings.load();
  });
  ipcMain.handle("settings:set", async (_e, patch) => {
    await initialSettingsReady;
    const current = settings.load();
    if (
      patch &&
      Object.prototype.hasOwnProperty.call(patch, "zoteroLinkedAttachmentRoot") &&
      patch.zoteroLinkedAttachmentRoot !== current.zoteroLinkedAttachmentRoot
    ) {
      throw new Error("Zotero 链接附件目录只能通过系统目录选择器修改");
    }
    const merged = settings.merge(patch);
    invalidateEnvironmentCaches();
    return merged;
  });
  ipcMain.handle("env:probe", async (_e, draft, options) => {
    await initialSettingsReady;
    return probeEnvironment(
      { ...settings.load(), ...(draft || {}) },
      { force: !!(options && options.force) }
    );
  });
  // Live model list for the settings picker (Trae only): shells out to
  // `trae-cli models --json` so the UI reflects what's actually reachable +
  // each model's current load, instead of a stale hardcoded list.
  ipcMain.handle("trae:models", async () => {
    await initialSettingsReady;
    return runBackgroundTask("listTraeModels", { traePath: settings.load().traePath });
  });
  ipcMain.handle("settings:open", () => {
    createSettingsWindow();
    return { ok: true };
  });

  // The API key is never part of config.json or the public website bundle.
  // Only the immutable shell may load it, and only the Settings window may
  // replace/clear it after Zotero verifies personal-library write access.
  ipcMain.handle("zotero:getSession", (event) => {
    if (!trustedAppPage(event, ["app://local/shell.html"])) return null;
    try {
      return zoteroCredentialStore.load();
    } catch (error) {
      console.error("[main] Zotero credential load failed:", error && error.code);
      return null;
    }
  });
  ipcMain.handle("zotero:credentialStatus", (event) => {
    if (!trustedAppPage(event, ["app://local/shell.html", "app://local/settings.html"])) {
      return { configured: false, usable: false, errorCode: "UNTRUSTED_CALLER" };
    }
    return zoteroCredentialStore.status();
  });
  ipcMain.handle("zotero:verifyAndSaveCredentials", async (event, apiKey) => {
    if (!trustedAppPage(event, ["app://local/settings.html"])) {
      return { ok: false, code: "UNTRUSTED_CALLER", reason: "已拒绝非设置窗口的凭据修改" };
    }
    try {
      const credentials = await verifyZoteroApiKey(apiKey, {
        fetchImpl: net.fetch,
        signal: AbortSignal.timeout(30_000),
      });
      const status = zoteroCredentialStore.save(credentials);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("zotero:credentialsChanged", { configured: true });
      }
      return { ok: true, configured: true, userId: credentials.userId, usable: status.usable };
    } catch (error) {
      return {
        ok: false,
        code: (error && error.code) || "CREDENTIAL_SAVE_FAILED",
        reason: zoteroCredentialReason(error),
      };
    }
  });
  ipcMain.handle("zotero:clearCredentials", (event) => {
    if (!trustedAppPage(event, ["app://local/settings.html"])) {
      return { ok: false, code: "UNTRUSTED_CALLER" };
    }
    try {
      const result = zoteroCredentialStore.clear();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("zotero:credentialsChanged", { configured: false });
      }
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, code: error && error.code, reason: "无法清除本机 Zotero 凭据" };
    }
  });
  ipcMain.handle("zotero:setupStatus", (event, draftRoot) => {
    if (!trustedAppPage(event, ["app://local/settings.html", "app://local/shell.html"])) {
      return { detected: false, reason: "已拒绝非 App 页面检测" };
    }
    const configuredRoot =
      typeof draftRoot === "string" ? draftRoot.trim() : settings.load().zoteroLinkedAttachmentRoot;
    try {
      const detected = readZoteroBaseAttachmentPath({ homeDir: app.getPath("home") });
      const zoteroBaseDir = resolveMacOneDriveRoot(detected);
      let appRoot = "";
      try {
        if (configuredRoot) appRoot = resolveMacOneDriveRoot(configuredRoot);
      } catch {}
      return {
        detected: true,
        zoteroBaseDir,
        configuredRoot,
        match: !!appRoot && appRoot === zoteroBaseDir,
      };
    } catch (error) {
      return { detected: false, configuredRoot, reason: linkedPdfErrorReason(error) };
    }
  });

  // A sandboxed live report is data, not an authority. The trusted shell may
  // consume one recent browser-process input for one validated mutation. No
  // reusable capability is returned to the report frame.
  ipcMain.handle("report:consumeGesture", (event, payload) => {
    const frameUrl = (event.senderFrame && event.senderFrame.url) || "";
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      event.sender !== mainWindow.webContents ||
      frameUrl !== "app://local/shell.html"
    ) {
      return { allowed: false, code: "UNTRUSTED_CALLER" };
    }
    const allowedActions = new Set([
      "paper-read",
      "vault-open",
      "vault-update",
      "zotero-add",
      "zotero-remove",
    ]);
    const action = payload && payload.action;
    const reportFile = payload && payload.reportFile;
    const identity = payload && payload.identity;
    if (
      !allowedActions.has(action) ||
      !/^\d{4}_\d{2}_\d{2}\.html$/.test(reportFile || "") ||
      typeof identity !== "string" ||
      identity.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(identity)
    ) {
      return { allowed: false, code: "INVALID_GESTURE_SCOPE" };
    }
    if (!mainWindow.isFocused()) {
      return { allowed: false, code: "WINDOW_NOT_FOCUSED" };
    }
    return reportGestureGate.consume();
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

  // Materialise an arXiv PDF inside Zotero's OneDrive-backed Linked
  // Attachment Base Directory. The renderer supplies only a canonical source
  // URL; the root and final filename remain main-process controlled.
  ipcMain.handle("zotero:writeLinkedPdf", async (event, payload) => {
    const sourceUrl = payload && payload.sourceUrl;
    const frameUrl = (event.senderFrame && event.senderFrame.url) || "";
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      event.sender !== mainWindow.webContents ||
      frameUrl !== "app://local/shell.html"
    ) {
      return { ok: false, code: "UNTRUSTED_CALLER", reason: "已拒绝非 App 主窗口的附件写入请求" };
    }
    const operationKey = typeof sourceUrl === "string" ? sourceUrl : "";
    return zoteroPdfWrites.enqueue(operationKey, async () => {
      try {
        const root = resolveVerifiedZoteroRoot(settings.load().zoteroLinkedAttachmentRoot);
        const stored = await saveArxivPdf({
          root,
          url: sourceUrl,
          fetchImpl: net.fetch,
          signal: AbortSignal.timeout(120000),
        });
        const cloud = await verifyOneDriveCloudFile(path.join(root, stored.filename));
        if (!cloud.confirmed) {
          const error = new Error("OneDrive cloud confirmation is unavailable");
          error.code = "CLOUD_CONFIRM_UNAVAILABLE";
          throw error;
        }
        await verifySavedPdf({
          root,
          filename: stored.filename,
          bytes: stored.bytes,
          sha256: stored.sha256,
        });
        return { ...stored, cloudConfirmed: true };
      } catch (error) {
        return {
          ok: false,
          code: (error && error.code) || "LINKED_PDF_FAILED",
          reason: linkedPdfErrorReason(error),
        };
      }
    });
  });

  ipcMain.handle("settings:pickVault", async () => {
    const r = await dialog.showOpenDialog(settingsWindow || mainWindow, {
      properties: ["openDirectory"],
      title: "选择用于保存论文笔记的 Obsidian vault",
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("settings:pickCodex", async () => {
    const r = await dialog.showOpenDialog(settingsWindow || mainWindow, {
      properties: ["openFile"],
      title: "选择 Codex CLI 可执行文件",
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
  ipcMain.handle("settings:pickTrae", async () => {
    const r = await dialog.showOpenDialog(settingsWindow || mainWindow, {
      properties: ["openFile"],
      title: "选择 Trae CLI 可执行文件",
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("settings:pickZoteroAttachmentRoot", async () => {
    const r = await dialog.showOpenDialog(settingsWindow || mainWindow, {
      properties: ["openDirectory"],
      title: "选择 Zotero 链接附件基准目录",
    });
    if (r.canceled) return null;
    try {
      const root = resolveVerifiedZoteroRoot(r.filePaths[0]);
      settings.merge({ zoteroLinkedAttachmentRoot: root });
      return root;
    } catch (error) {
      await dialog.showMessageBox(settingsWindow || mainWindow, {
        type: "error",
        title: "Zotero 目录不匹配",
        message: linkedPdfErrorReason(error),
        detail: "请在 Zotero → 设置 → 高级 → 文件和文件夹中确认 Linked Attachment Base Directory。",
        buttons: ["知道了"],
      });
      return null;
    }
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
  zoteroCredentialStore = createZoteroCredentialStore({
    safeStorage,
    userDataDir: app.getPath("userData"),
  });
  try {
    paperCacheDir = preparePaperCacheDir();
  } catch (error) {
    paperCacheDir = null;
    console.error("[main] app cache initialization failed:", error && error.message);
  }
  initialSettingsReady = firstRunInit();

  queue = new JobQueue({
    settings: () => settings.load(),
    cacheDir: paperCacheDir,
    onProgress: (evt) => {
      if (evt && evt.state === "done") vaultScanCache = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("paper:progress", evt);
      }
    },
  });

  wireIpc();
  createMainWindow();

  // Reclaim scratch files after first-run discovery, but never block Electron's
  // main thread while walking/deleting a large cache tree.
  startupMaintenanceReady = initialSettingsReady
    .then(() =>
      paperCacheDir ? runBackgroundTask("sweepCache", { cacheDir: paperCacheDir }) : null
    )
    .then((swept) => {
      if (swept && (swept.files || swept.dirs)) {
        console.log(`[main] cache sweep removed ${swept.files} files, ${swept.dirs} dirs`);
      }
    })
    .catch((error) => {
      console.error("[main] startup cache sweep failed:", error);
      return null;
    });

  // <webview> guests: route their popups (in-page links opening new windows) to
  // in-app tabs as well, so nothing ever spawns a native window.
  app.on("web-contents-created", (_e, contents) => {
    if (typeof contents.getType === "function" && contents.getType() === "webview") {
      contents.setWindowOpenHandler(({ url }) => routeOpenUrl(url));
    }
  });

  // If prerequisites are missing, surface settings after the background probe.
  // The main window is already interactive while login-shell/CLI checks run.
  initialSettingsReady
    .then((current) => probeEnvironment(current, { force: true }))
    .then((probe) => {
      if (!probe.ready) createSettingsWindow();
    })
    .catch((error) => {
      console.error("[main] startup environment probe failed:", error && error.message);
      createSettingsWindow();
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
