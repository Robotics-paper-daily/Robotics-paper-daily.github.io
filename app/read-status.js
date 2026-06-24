// Shared helpers for the manual "已读" checkbox at the END of a paper note.
// The note ends with a clickable Obsidian task line:  - [ ] ✅ 已读
// Toggling it in Obsidian (or in the app) flips [ ] ↔ [x]; it lives in the note
// so it syncs with the user's Obsidian sync. The app reads it to mark cards and
// can write it back. Pure string helpers — used by vault-scan.js (read) and
// main.js (write), and unit-tested.

// Matches the read-checkbox line: "- [ ] ✅ 已读" / "- [x] 已读" (emoji optional).
const READ_RE = /^[ \t]*-[ \t]*\[([ xX])\][ \t]*(?:✅[ \t]*)?已读[ \t]*$/m;

function isReadChecked(text) {
  const m = (text || "").match(READ_RE);
  return !!(m && (m[1] === "x" || m[1] === "X"));
}

// Return the note text with the 已读 checkbox set to `read`. Flips an existing
// checkbox in place; if none exists, appends one (under a rule) at the very end.
function setReadInNoteText(text, read) {
  const line = `- [${read ? "x" : " "}] ✅ 已读`;
  if (READ_RE.test(text || "")) return (text || "").replace(READ_RE, line);
  const base = (text || "").replace(/\s*$/, "");
  return `${base}\n\n---\n${line}\n`;
}

module.exports = { isReadChecked, setReadInNoteText, READ_RE };
