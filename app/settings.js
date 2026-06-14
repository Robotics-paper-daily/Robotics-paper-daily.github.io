// Persistent app settings, stored as config.json under the Electron userData
// dir (e.g. %APPDATA%\PaperReader\config.json on Windows). Pure main-process
// module — requires electron's `app` for the path.

const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const DEFAULTS = {
  vaultPath: "", // Obsidian vault containing .claude/skills/paper-reading
  claudePath: "", // optional override; "" = auto-resolve (spawn-claude.js)
  concurrency: 10, // simultaneous reads
  model: "opus", // --model alias; "" = CLI/settings default
  permissionMode: "bypassPermissions",
  maxBudgetUsd: 0, // 0 = no cap; else passed as --max-budget-usd
  liveBase: "https://robotics-paper-daily.github.io", // pull latest papers from here; "" = bundled/offline only
};

function configFile() {
  return path.join(app.getPath("userData"), "config.json");
}

function load() {
  try {
    const raw = fs.readFileSync(configFile(), "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function clampInt(v, lo, hi, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// Merge a partial patch, validate, persist, return the full settings object.
function merge(patch) {
  const next = { ...load(), ...(patch || {}) };
  next.concurrency = clampInt(next.concurrency, 1, 16, DEFAULTS.concurrency);
  if (typeof next.vaultPath !== "string") next.vaultPath = "";
  if (typeof next.claudePath !== "string") next.claudePath = "";
  if (typeof next.liveBase !== "string") next.liveBase = DEFAULTS.liveBase;
  next.liveBase = next.liveBase.trim().replace(/\/$/, "");
  if (!["sonnet", "opus", "haiku", ""].includes(next.model)) {
    // allow full model ids too, just don't allow garbage types
    if (typeof next.model !== "string") next.model = DEFAULTS.model;
  }
  const n = parseFloat(next.maxBudgetUsd);
  next.maxBudgetUsd = Number.isFinite(n) && n > 0 ? n : 0;
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), "utf8");
  } catch (e) {
    console.error("[settings] write failed:", e);
  }
  return next;
}

module.exports = { load, merge, configFile, DEFAULTS };
