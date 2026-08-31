// Cache hygiene for the app-owned <userData>/paper-cache directory. Callers
// pass that directory itself (never an Obsidian vault); the conservative path
// check keeps an accidental vault/.cache argument from becoming destructive.

const fs = require("fs");
const path = require("path");

function baseArxivId(id) {
  return id ? String(id).replace(/v\d+$/i, "") : null;
}

// Accept only a non-root absolute directory named exactly `paper-cache`, which
// is the leaf main.js derives from app.getPath("userData"). This is a second
// line of defence around deletion; main.js remains the authority that chooses
// the actual userData parent.
function normalizeAppCacheDir(cacheDir) {
  if (typeof cacheDir !== "string" || !cacheDir || !path.isAbsolute(cacheDir)) return null;
  const normalized = path.resolve(cacheDir);
  if (path.basename(normalized) !== "paper-cache") return null;
  const parent = path.dirname(normalized);
  if (parent === path.parse(normalized).root) return null;
  return normalized;
}

function existingCacheRoot(cacheDir) {
  const root = normalizeAppCacheDir(cacheDir);
  if (!root) return null;
  try {
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    return root;
  } catch {
    return null;
  }
}

// Delete paper-cache/papers/<baseId>(vN)?.*. Returns the number of files
// removed. It never follows a symlink planted at papers/.
function cleanPaperCache(cacheDir, id) {
  const baseId = baseArxivId(id);
  const root = existingCacheRoot(cacheDir);
  if (!root || !baseId) return 0;
  const dir = path.join(root, "papers");
  let files;
  try {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return 0;
    files = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const esc = baseId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^" + esc + "(?:v\\d+)?\\.", "i");
  let n = 0;
  for (const file of files) {
    if (!file.isFile() && !file.isSymbolicLink()) continue;
    if (!re.test(file.name)) continue;
    try {
      fs.unlinkSync(path.join(dir, file.name));
      n++;
    } catch {}
  }
  return n;
}

function keepIdSet(keepIds) {
  const set = new Set();
  for (const id of keepIds || []) {
    if (!id) continue;
    set.add(String(id).toLowerCase());
    const base = baseArxivId(id);
    if (base) set.add(base.toLowerCase());
  }
  return set;
}

// Whole-cache startup sweep. Since the root is dedicated to PaperReader,
// every entry is disposable scratch except files belonging to an explicitly
// active paper. Root and child symlinks are removed as links, never traversed.
function sweepCache(cacheDir, opts = {}) {
  const result = { files: 0, dirs: 0 };
  const root = existingCacheRoot(cacheDir);
  if (!root) return result;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return result;
  }
  const keep = keepIdSet(opts.keepIds);
  const rm = (target) => {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  };

  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory() && entry.name === "papers") {
      let papers = [];
      try {
        papers = fs.readdirSync(full, { withFileTypes: true });
      } catch {}
      for (const paper of papers) {
        const filename = paper.name;
        const base = baseArxivId(filename.replace(/\.(dec\.pdf|pdf|txt)$/i, "")) || "";
        if (keep.has(filename.toLowerCase()) || (base && keep.has(base.toLowerCase()))) continue;
        if (rm(path.join(full, filename))) {
          if (paper.isDirectory()) result.dirs++;
          else result.files++;
        }
      }
      if (!keep.size) {
        try {
          if (!fs.readdirSync(full).length && rm(full)) result.dirs++;
        } catch {}
      }
      continue;
    }
    if (entry.isDirectory()) {
      if (rm(full)) result.dirs++;
    } else if (rm(full)) {
      result.files++;
    }
  }
  return result;
}

module.exports = { cleanPaperCache, sweepCache, baseArxivId, normalizeAppCacheDir };
