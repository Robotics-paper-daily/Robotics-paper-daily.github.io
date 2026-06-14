// Scan the LOCAL vault for already-read papers. A note folder is
// <vault>/<date>/<title>/ containing <id>.pdf + <title>.md. We map each note's
// base arxiv id → its vault-relative path (no extension) so the app can mark a
// paper as 已读 and open the existing note. Cheap: readdir only, no file reads.
// Cross-device is the user's own Obsidian sync — we only ever read this machine.

const fs = require("fs");
const path = require("path");

function baseArxivId(id) {
  return id ? String(id).replace(/v\d+$/i, "") : null;
}

function scanReadPapers(vaultPath) {
  const out = {};
  if (!vaultPath) return out;
  let top;
  try {
    top = fs.readdirSync(vaultPath, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of top) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue; // skip .obsidian/.claude/.cache/.trash
    const dateDir = path.join(vaultPath, d.name);
    let titles;
    try {
      titles = fs.readdirSync(dateDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const t of titles) {
      if (!t.isDirectory()) continue;
      const noteDir = path.join(dateDir, t.name);
      let files;
      try {
        files = fs.readdirSync(noteDir);
      } catch {
        continue;
      }
      const pdf = files.find((f) => /\.pdf$/i.test(f));
      if (!pdf || !files.includes(t.name + ".md")) continue; // need pdf + matching note
      const id = baseArxivId(pdf.replace(/\.pdf$/i, ""));
      if (!id) continue;
      // keep the newest if the same id was read on multiple days (last wins by name order)
      out[id] = `${d.name}/${t.name}/${t.name}`; // vault-relative, no extension
    }
  }
  return out;
}

module.exports = { scanReadPapers, baseArxivId };
