// Persistent app settings, stored as config.json under the Electron userData
// dir (e.g. %APPDATA%\PaperReader\config.json on Windows). Pure main-process
// module — requires electron's `app` for the path.

const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const DEFAULTS = {
  vaultPath: "", // Obsidian vault used as the notes destination
  zoteroLinkedAttachmentRoot: "", // must match Zotero's Linked Attachment Base Directory
  // Codex is the portable fresh-install default. First-run discovery follows
  // Codex -> Claude -> Trae; an existing explicit provider choice is never
  // changed.
  provider: "codex",
  codexPath: "", // optional override; "" = auto-resolve (spawn-codex.js)
  claudePath: "", // optional override; "" = auto-resolve (spawn-claude.js)
  traePath: "", // optional override; "" = auto-resolve (spawn-trae.js)
  pythonPath: "", // optional interpreter override; "" = auto-probe (env-probe.js)
  concurrency: 10, // simultaneous reads
  model: "sonnet", // --model alias; "" = CLI/settings default
  codexModel: "", // empty = Codex service/CLI default for this isolated job
  codexReasoningEffort: "", // empty = Codex service/CLI default for this isolated job
  traeModel: "gpt-5.4",
  traeBackendVariant: "max",
  traeReasoningEffort: "ultra",
  permissionMode: "bypassPermissions",
  maxBudgetUsd: 0, // 0 = no cap; else passed as --max-budget-usd
  liveBase: "https://robotics-paper-daily.github.io", // pull latest papers from here; "" = bundled/offline only
};

const PROVIDERS = Object.freeze(["codex", "claude", "trae"]);

function validProvider(value) {
  return PROVIDERS.includes(value);
}

function configFile() {
  return path.join(app.getPath("userData"), "config.json");
}

function readSaved() {
  try {
    return { exists: true, saved: JSON.parse(fs.readFileSync(configFile(), "utf8")) };
  } catch (error) {
    return { exists: !!error && error.code !== "ENOENT", saved: null, error };
  }
}

function load() {
  const { saved, error } = readSaved();
  if (saved) {
    const loaded = {
      ...DEFAULTS,
      ...saved,
      provider: validProvider(saved.provider) ? saved.provider : DEFAULTS.provider,
    };
    loaded.zoteroLinkedAttachmentRoot = normalizeZoteroLinkedAttachmentRoot(
      loaded.zoteroLinkedAttachmentRoot,
      false
    );
    return loaded;
  }
  if (error && error.code !== "ENOENT") console.error("[settings] read failed:", error);
  return { ...DEFAULTS };
}

function providerConfigured() {
  const { exists, saved } = readSaved();
  return exists && !!(saved && validProvider(saved.provider));
}

function clampInt(v, lo, hi, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function normalizeZoteroLinkedAttachmentRoot(value, rejectInvalid) {
  if (typeof value !== "string") {
    if (rejectInvalid) throw new Error("Zotero 链接附件基准目录必须为空或绝对路径");
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!path.isAbsolute(trimmed)) {
    if (rejectInvalid) throw new Error("Zotero 链接附件基准目录必须为空或绝对路径");
    return "";
  }
  return trimmed;
}

// Merge a partial patch, validate, persist, return the full settings object.
function merge(patch) {
  const hasZoteroLinkedAttachmentRoot = Object.prototype.hasOwnProperty.call(
    patch || {},
    "zoteroLinkedAttachmentRoot"
  );
  let base;
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    base = {
      ...DEFAULTS,
      ...raw,
      provider: validProvider(raw.provider) ? raw.provider : DEFAULTS.provider,
    };
  } catch (e) {
    if (e && e.code !== "ENOENT") throw new Error("现有配置无法读取，请先修复 config.json：" + e.message);
    base = { ...DEFAULTS };
  }
  const next = { ...base, ...(patch || {}) };
  next.concurrency = clampInt(next.concurrency, 1, 16, DEFAULTS.concurrency);
  next.zoteroLinkedAttachmentRoot = normalizeZoteroLinkedAttachmentRoot(
    next.zoteroLinkedAttachmentRoot,
    hasZoteroLinkedAttachmentRoot
  );
  if (!validProvider(next.provider)) next.provider = DEFAULTS.provider;
  if (typeof next.vaultPath !== "string") next.vaultPath = "";
  if (typeof next.codexPath !== "string") next.codexPath = "";
  if (typeof next.claudePath !== "string") next.claudePath = "";
  if (typeof next.traePath !== "string") next.traePath = "";
  if (typeof next.pythonPath !== "string") next.pythonPath = "";
  else next.pythonPath = next.pythonPath.trim();
  if (typeof next.liveBase !== "string") next.liveBase = DEFAULTS.liveBase;
  next.liveBase = next.liveBase.trim().replace(/\/$/, "");
  if (!["sonnet", "opus", "haiku", ""].includes(next.model)) {
    // allow full model ids too, just don't allow garbage types
    if (typeof next.model !== "string") next.model = DEFAULTS.model;
  }
  if (typeof next.codexModel !== "string") next.codexModel = "";
  else next.codexModel = next.codexModel.trim();
  if (!["", "minimal", "low", "medium", "high", "xhigh"].includes(next.codexReasoningEffort)) {
    next.codexReasoningEffort = "";
  }
  if (typeof next.traeModel !== "string" || !next.traeModel.trim()) {
    next.traeModel = DEFAULTS.traeModel;
  } else next.traeModel = next.traeModel.trim();
  if (typeof next.traeBackendVariant !== "string") {
    next.traeBackendVariant = DEFAULTS.traeBackendVariant;
  }
  if (typeof next.traeReasoningEffort !== "string") {
    next.traeReasoningEffort = DEFAULTS.traeReasoningEffort;
  }
  if (!next.traeBackendVariant || next.traeBackendVariant !== "max") next.traeBackendVariant = "";
  if (!["low", "medium", "high", "xhigh", "max", "ultra"].includes(next.traeReasoningEffort)) {
    next.traeReasoningEffort = DEFAULTS.traeReasoningEffort;
  }
  const n = parseFloat(next.maxBudgetUsd);
  next.maxBudgetUsd = Number.isFinite(n) && n > 0 ? n : 0;
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), "utf8");
  } catch (e) {
    throw new Error("配置保存失败：" + e.message);
  }
  return next;
}

module.exports = { load, merge, configFile, providerConfigured, DEFAULTS };
