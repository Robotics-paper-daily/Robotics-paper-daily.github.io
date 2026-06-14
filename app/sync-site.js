// Copy the parts of the static site the app actually serves into app/site/, so
// the packaged app is self-contained (no sibling repo at runtime). Run as a
// prebuild step (npm run sync-site) and also called by main.js in dev if the
// snapshot is missing.

const fs = require("fs");
const path = require("path");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// root = repo root (parent of app/); dest = app/site
function syncSite(root, dest) {
  fs.mkdirSync(dest, { recursive: true });
  copyDir(path.join(root, "daily_html"), path.join(dest, "daily_html"));
  copyDir(path.join(root, "js"), path.join(dest, "js"));
  fs.copyFileSync(path.join(root, "reports.json"), path.join(dest, "reports.json"));
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const dest = path.join(__dirname, "site");
  syncSite(root, dest);
  console.log("[sync-site] snapshot written to", dest);
}

module.exports = { syncSite, copyDir };
