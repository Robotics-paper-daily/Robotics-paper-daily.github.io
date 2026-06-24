// Scan the LOCAL vault for already-read papers. A note folder is
// <vault>/<date>/<title>/ containing <id>.pdf + <title>.md. We map each note's
// base arxiv id → { rel: vault-relative path (no extension), read: bool } so the
// app can open the existing note AND show the manual 已读 state (the checkbox at
// the note's end). readdir + a small tail-read per note (the checkbox line).
// Cross-device is the user's own Obsidian sync — we only ever read this machine.

const fs = require("fs");
const path = require("path");
const { isReadChecked } = require("./read-status");

function baseArxivId(id) {
  return id ? String(id).replace(/v\d+$/i, "") : null;
}

// Read the last `n` bytes of a file (the 已读 checkbox is the note's last line),
// so we don't slurp whole 30KB notes just to check one line.
function readTail(p, n) {
  let fd;
  try {
    fd = fs.openSync(p, "r");
    const size = fs.fstatSync(fd).size;
    const len = Math.min(n, size);
    const buf = Buffer.alloc(len);
    if (len) fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
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
      out[id] = {
        rel: `${d.name}/${t.name}/${t.name}`, // vault-relative, no extension
        read: isReadChecked(readTail(path.join(noteDir, t.name + ".md"), 4096)),
      };
    }
  }
  return out;
}

module.exports = { scanReadPapers, baseArxivId };
