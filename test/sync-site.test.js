const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { syncSite, APP_JS_FILES } = require("../app/sync-site");

test("syncSite recreates the whole snapshot and packages an explicit JS allowlist", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-sync-root-"));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-sync-dest-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(root, "daily_html"), { recursive: true });
  fs.mkdirSync(path.join(root, "js"), { recursive: true });
  fs.writeFileSync(path.join(root, "daily_html", "2026_08_11.html"), "report");
  fs.writeFileSync(path.join(root, "reports.json"), "[]");
  for (const file of APP_JS_FILES) fs.writeFileSync(path.join(root, "js", file), file);
  fs.writeFileSync(path.join(root, "js", "secrets.enc.js"), "must-not-ship");
  fs.writeFileSync(path.join(root, "js", "webdav.js"), "must-not-ship");

  fs.mkdirSync(path.join(dest, "js"), { recursive: true });
  fs.writeFileSync(path.join(dest, "js", "secrets.enc.js"), "stale-secret");
  fs.mkdirSync(path.join(dest, "daily_html"), { recursive: true });
  fs.writeFileSync(path.join(dest, "daily_html", "2025_01_01.html"), "obsolete-report");
  fs.writeFileSync(path.join(dest, "developer-private.txt"), "root-sentinel");

  syncSite(root, dest);

  assert.deepStrictEqual(fs.readdirSync(path.join(dest, "js")).sort(), [...APP_JS_FILES].sort());
  assert.strictEqual(fs.existsSync(path.join(dest, "js", "secrets.enc.js")), false);
  assert.strictEqual(fs.existsSync(path.join(dest, "js", "webdav.js")), false);
  assert.strictEqual(fs.existsSync(path.join(dest, "daily_html", "2025_01_01.html")), false);
  assert.strictEqual(fs.existsSync(path.join(dest, "developer-private.txt")), false);
  assert.strictEqual(fs.readFileSync(path.join(dest, "daily_html", "2026_08_11.html"), "utf8"), "report");
  assert.deepStrictEqual(fs.readdirSync(dest).sort(), ["daily_html", "js", "reports.json"]);
});
