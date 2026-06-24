// Remove one paper's intermediate files under <vault>/.cache/papers/ (the
// downloaded PDF, decrypted PDF, and text dump — named by base arxiv id) after
// its note is written, so the cache never accumulates / gets synced into the
// vault. Per-paper by design: concurrent reads of OTHER papers are untouched
// (so we never `rm -rf .cache`). Pure + sync; unit-tested.

const fs = require("fs");
const path = require("path");

function baseArxivId(id) {
  return id ? String(id).replace(/v\d+$/i, "") : null;
}

// Delete .cache/papers/<baseId>(vN)?.* under vaultPath. Returns removed count.
function cleanPaperCache(vaultPath, id) {
  const baseId = baseArxivId(id);
  if (!vaultPath || !baseId) return 0;
  const dir = path.join(vaultPath, ".cache", "papers");
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  const esc = baseId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^" + esc + "(?:v\\d+)?\\.", "i"); // <id>.pdf | <id>.txt | <id>.dec.pdf
  let n = 0;
  for (const f of files) {
    if (!re.test(f)) continue;
    try {
      fs.unlinkSync(path.join(dir, f));
      n++;
    } catch {}
  }
  return n;
}

module.exports = { cleanPaperCache, baseArxivId };
