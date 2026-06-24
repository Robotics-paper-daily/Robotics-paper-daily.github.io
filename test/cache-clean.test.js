// Tests for per-paper .cache cleanup. Run: node --test test/cache-clean.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { cleanPaperCache } = require("../app/cache-clean");

function setup() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pr-cache-"));
  const papers = path.join(vault, ".cache", "papers");
  fs.mkdirSync(papers, { recursive: true });
  const write = (n) => fs.writeFileSync(path.join(papers, n), "x");
  return { vault, papers, write };
}

test("removes exactly the target paper's files (pdf/txt/dec), leaves others", () => {
  const { vault, papers, write } = setup();
  write("2606.13675.pdf");
  write("2606.13675.txt");
  write("2606.13675.dec.pdf");
  write("2606.99999.pdf"); // a concurrent OTHER paper — must survive
  write("2606.99999.txt");

  const n = cleanPaperCache(vault, "2606.13675v1"); // pass full id; cleanup strips version
  assert.strictEqual(n, 3);
  const left = fs.readdirSync(papers).sort();
  assert.deepStrictEqual(left, ["2606.99999.pdf", "2606.99999.txt"]);
});

test("matches a versioned cache filename too", () => {
  const { vault, papers, write } = setup();
  write("2606.13675v2.txt"); // some steps may save by full id
  write("2606.13675.pdf");
  const n = cleanPaperCache(vault, "2606.13675");
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(fs.readdirSync(papers), []);
});

test("does not match a different id that shares a prefix", () => {
  const { vault, papers, write } = setup();
  write("2606.13675.pdf");
  write("2606.136759.pdf"); // longer id, must NOT be deleted
  const n = cleanPaperCache(vault, "2606.13675");
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(fs.readdirSync(papers), ["2606.136759.pdf"]);
});

test("safe no-ops: missing vault / no id / absent cache dir", () => {
  assert.strictEqual(cleanPaperCache("", "2606.1"), 0);
  assert.strictEqual(cleanPaperCache("/nope", ""), 0);
  const v = fs.mkdtempSync(path.join(os.tmpdir(), "pr-cache-"));
  assert.strictEqual(cleanPaperCache(v, "2606.13675"), 0); // no .cache/papers
});
