// Tests for app-owned paper-cache cleanup. Run: node --test test/cache-clean.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { cleanPaperCache, sweepCache, normalizeAppCacheDir } = require("../app/cache-clean");

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pr-cache-"));
  const cacheDir = path.join(root, "paper-cache");
  const papers = path.join(cacheDir, "papers");
  fs.mkdirSync(papers, { recursive: true });
  const write = (name) => fs.writeFileSync(path.join(papers, name), "x");
  return { root, cacheDir, papers, write };
}

test("accepts only an absolute non-root paper-cache directory", () => {
  const cacheDir = path.join(os.tmpdir(), "paperreader-owner", "paper-cache");
  assert.strictEqual(normalizeAppCacheDir(cacheDir), path.resolve(cacheDir));
  assert.strictEqual(normalizeAppCacheDir("paper-cache"), null);
  assert.strictEqual(normalizeAppCacheDir(path.join(os.tmpdir(), ".cache")), null);
  assert.strictEqual(normalizeAppCacheDir(path.join(path.parse(cacheDir).root, "paper-cache")), null);
});

test("removes exactly the target paper's files and leaves concurrent papers", (t) => {
  const { root, cacheDir, papers, write } = setup();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write("2606.13675.pdf");
  write("2606.13675.txt");
  write("2606.13675.dec.pdf");
  write("2606.99999.pdf");
  write("2606.99999.txt");

  const n = cleanPaperCache(cacheDir, "2606.13675v1");
  assert.strictEqual(n, 3);
  assert.deepStrictEqual(fs.readdirSync(papers).sort(), ["2606.99999.pdf", "2606.99999.txt"]);
});

test("matches a versioned cache filename too", (t) => {
  const { root, cacheDir, papers, write } = setup();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write("2606.13675v2.txt");
  write("2606.13675.pdf");
  assert.strictEqual(cleanPaperCache(cacheDir, "2606.13675"), 2);
  assert.deepStrictEqual(fs.readdirSync(papers), []);
});

test("does not match a different id that shares a prefix", (t) => {
  const { root, cacheDir, papers, write } = setup();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write("2606.13675.pdf");
  write("2606.136759.pdf");
  assert.strictEqual(cleanPaperCache(cacheDir, "2606.13675"), 1);
  assert.deepStrictEqual(fs.readdirSync(papers), ["2606.136759.pdf"]);
});

test("legacy vault/.cache arguments are refused and never deleted", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pr-vault-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const papers = path.join(vault, ".cache", "papers");
  fs.mkdirSync(papers, { recursive: true });
  const file = path.join(papers, "2606.13675.pdf");
  fs.writeFileSync(file, "must survive");

  assert.strictEqual(cleanPaperCache(vault, "2606.13675"), 0);
  assert.strictEqual(cleanPaperCache(path.join(vault, ".cache"), "2606.13675"), 0);
  assert.deepStrictEqual(sweepCache(vault), { files: 0, dirs: 0 });
  assert.strictEqual(fs.readFileSync(file, "utf8"), "must survive");
});

test("safe no-ops: missing cache root, id, or papers directory", (t) => {
  assert.strictEqual(cleanPaperCache("", "2606.1"), 0);
  assert.strictEqual(cleanPaperCache("/nope/paper-cache", ""), 0);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pr-cache-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cacheDir = path.join(root, "paper-cache");
  fs.mkdirSync(cacheDir);
  assert.strictEqual(cleanPaperCache(cacheDir, "2606.13675"), 0);
});

test("sweepCache clears app scratch but keeps an active read's files", (t) => {
  const { root, cacheDir, papers, write } = setup();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write("2606.11324.pdf");
  write("2606.11324.txt");
  write("2410.24164v2.pdf");
  fs.mkdirSync(path.join(cacheDir, "allmmd"));
  fs.writeFileSync(path.join(cacheDir, "audit.py"), "x");

  const result = sweepCache(cacheDir, { keepIds: ["2410.24164"] });
  assert.strictEqual(result.files, 3);
  assert.strictEqual(result.dirs, 1);
  assert.deepStrictEqual(fs.readdirSync(papers), ["2410.24164v2.pdf"]);
  assert.deepStrictEqual(fs.readdirSync(cacheDir), ["papers"]);
});

test("sweepCache with no keepIds removes everything including papers", (t) => {
  const { root, cacheDir, papers, write } = setup();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write("2606.11324.pdf");
  const result = sweepCache(cacheDir);
  assert.strictEqual(result.files, 1);
  assert.strictEqual(result.dirs, 1);
  assert.strictEqual(fs.existsSync(papers), false);
});

test("sweepCache does not follow a symlink used as the cache root", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pr-cache-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  const file = path.join(outside, "keep.txt");
  fs.writeFileSync(file, "keep");
  const link = path.join(root, "paper-cache");
  try {
    fs.symlinkSync(outside, link, "dir");
  } catch {
    t.skip("symlinks unavailable");
    return;
  }
  assert.deepStrictEqual(sweepCache(link), { files: 0, dirs: 0 });
  assert.strictEqual(fs.readFileSync(file, "utf8"), "keep");
});
