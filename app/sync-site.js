// Copy the parts of the static site the app actually serves into app/site/, so
// the packaged app is self-contained (no sibling repo at runtime). Run as a
// prebuild step (npm run sync-site) and also called by main.js in dev if the
// snapshot is missing.

const fs = require("fs");
const path = require("path");

// Keep the packaged attack surface small and, critically, never copy the
// website's historical encrypted credentials or WebDAV implementation into a
// public App build. These are the only site-side scripts used by the shell or
// its hardened report frame.
const APP_JS_FILES = Object.freeze([
  "app-rpc.js",
  "like.js",
  "read-paper.js",
  "search-index.js",
  "translate.js",
  "zotero.js",
]);

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
  // `app/site` is generated output, never an incremental cache. Recreate the
  // whole tree so a previously copied credential bundle, obsolete report, or
  // developer-only file cannot survive into a later local package.
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  copyDir(path.join(root, "daily_html"), path.join(dest, "daily_html"));
  const jsDest = path.join(dest, "js");
  fs.mkdirSync(jsDest, { recursive: true });
  for (const file of APP_JS_FILES) {
    fs.copyFileSync(path.join(root, "js", file), path.join(jsDest, file));
  }
  fs.copyFileSync(path.join(root, "reports.json"), path.join(dest, "reports.json"));
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const dest = path.join(__dirname, "site");
  syncSite(root, dest);
  console.log("[sync-site] snapshot written to", dest);
}

module.exports = { syncSite, copyDir, APP_JS_FILES };
