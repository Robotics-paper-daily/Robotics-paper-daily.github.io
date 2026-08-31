const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return { shell: { openPath() {}, openExternal() {} } };
  return originalLoad.call(this, request, parent, isMain);
};
const { JobQueue, localDate, safeExistingNote } = require("../app/job-queue");
Module._load = originalLoad;
const codexAdapter = require("../app/spawn-codex");
const claudeAdapter = require("../app/spawn-claude");
const { findBundledPaperReadingSkill } = require("../app/skill-locator");

function makeQueue(vaultPath, cacheDir) {
  return new JobQueue({
    settings: () => ({ vaultPath, concurrency: 1 }),
    cacheDir: cacheDir || path.join(os.tmpdir(), "paperreader-test-user-data", "paper-cache"),
  });
}

function makeJob(extra = {}) {
  return {
    state: "running",
    payload: { arxivId: "2608.01234" },
    startedAt: Date.now(),
    t0: Date.now(),
    dateAtStart: localDate(),
    stderr: "",
    watchdog: null,
    _result: { isError: false },
    ...extra,
  };
}

test("_onClose keeps an error terminal event sticky", () => {
  const queue = makeQueue("/missing");
  const job = makeJob({ _result: { isError: true }, errorText: "failed" });
  queue._onClose(job, 0);
  assert.strictEqual(job.state, "error");
  assert.strictEqual(job.errorText, "failed");
});

test("_onClose rejects a nonzero exit after a successful result event", () => {
  const queue = makeQueue("/missing");
  const job = makeJob({ stderr: "late launcher failure\n" });
  queue._onClose(job, 1);
  assert.strictEqual(job.state, "error");
  assert.strictEqual(job.errorText, "late launcher failure");
});

test("_resolveFolder never falls back to an older unrelated paper", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-queue-"));
  const day = path.join(vault, localDate());
  const old = path.join(day, "old-paper");
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, "9999.99999.pdf"), "old");
  const queue = makeQueue(vault);
  const job = makeJob({ t0: Date.now() + 10000 });
  assert.strictEqual(queue._resolveFolder(job), null);
  fs.rmSync(vault, { recursive: true, force: true });
});

test("safeExistingNote resolves vault-relative paths and rejects symlink escapes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-note-path-"));
  const vault = path.join(root, "vault");
  const outside = path.join(root, "outside");
  fs.mkdirSync(path.join(vault, "day"), { recursive: true });
  fs.mkdirSync(outside);
  const note = path.join(vault, "day", "paper.md");
  fs.writeFileSync(note, "note");
  assert.strictEqual(safeExistingNote(vault, "day/paper.md"), fs.realpathSync(note));
  try {
    fs.symlinkSync(outside, path.join(vault, "linked"), "dir");
  } catch {
    t.skip("symlinks unavailable");
    fs.rmSync(root, { recursive: true, force: true });
    return;
  }
  const escaped = path.join(outside, "paper.md");
  fs.writeFileSync(escaped, "outside");
  assert.strictEqual(safeExistingNote(vault, "linked/paper.md"), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("_cleanCache removes only the app cache and never a vault .cache", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-cache-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, "vault");
  const cacheDir = path.join(root, "user-data", "paper-cache");
  const appPapers = path.join(cacheDir, "papers");
  const vaultPapers = path.join(vault, ".cache", "papers");
  fs.mkdirSync(appPapers, { recursive: true });
  fs.mkdirSync(vaultPapers, { recursive: true });
  fs.writeFileSync(path.join(appPapers, "2608.01234.pdf"), "app scratch");
  fs.writeFileSync(path.join(vaultPapers, "2608.01234.pdf"), "vault data");

  const queue = makeQueue(vault, cacheDir);
  queue._cleanCache(makeJob());

  assert.strictEqual(fs.existsSync(path.join(appPapers, "2608.01234.pdf")), false);
  assert.strictEqual(fs.readFileSync(path.join(vaultPapers, "2608.01234.pdf"), "utf8"), "vault data");
});

test("_start passes the exact bundled skill and app cache to Claude", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-spawn-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, "vault");
  const cacheDir = path.join(root, "user-data", "paper-cache");
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const settings = {
    provider: "claude",
    claudePath: process.execPath,
    vaultPath: vault,
    concurrency: 1,
  };
  const queue = new JobQueue({ settings: () => settings, cacheDir });
  const job = makeJob({
    state: "queued",
    payload: {
      url: "https://arxiv.org/abs/2608.01234",
      arxivId: "2608.01234",
    },
  });
  let captured = null;
  const originalSpawnRead = claudeAdapter.spawnRead;
  claudeAdapter.spawnRead = (args) => {
    captured = args;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  };
  t.after(() => {
    claudeAdapter.spawnRead = originalSpawnRead;
    if (job.watchdog) clearTimeout(job.watchdog);
  });

  queue._start(job, settings);

  assert.ok(captured);
  assert.strictEqual(captured.cacheDir, cacheDir);
  assert.strictEqual(captured.skillPath, findBundledPaperReadingSkill());
  assert.ok(path.isAbsolute(captured.skillPath));
  clearTimeout(job.watchdog);
  job.watchdog = null;
  job.state = "canceled";
});

test("_start routes Codex through its adapter with exact skill, cache, and model settings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-codex-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, "vault");
  const cacheDir = path.join(root, "user-data", "paper-cache");
  const pythonRoot = path.join(root, "python-runtime");
  const pythonPath = path.join(pythonRoot, "bin", "python3");
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const settings = {
    provider: "codex",
    codexPath: process.execPath,
    codexModel: "gpt-5.4",
    codexReasoningEffort: "high",
    vaultPath: vault,
    concurrency: 1,
  };
  const queue = new JobQueue({ settings: () => settings, cacheDir });
  const job = makeJob({
    state: "queued",
    payload: { url: "https://arxiv.org/abs/2608.01234", arxivId: "2608.01234" },
    runtime: { pythonPath, pythonReadRoots: [pythonRoot] },
  });
  let captured = null;
  const originalSpawnRead = codexAdapter.spawnRead;
  codexAdapter.spawnRead = (args) => {
    captured = args;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  };
  t.after(() => {
    codexAdapter.spawnRead = originalSpawnRead;
    if (job.watchdog) clearTimeout(job.watchdog);
  });

  queue._start(job, settings);

  assert.ok(captured);
  assert.strictEqual(captured.codexPath, process.execPath);
  assert.strictEqual(captured.cacheDir, cacheDir);
  assert.strictEqual(captured.skillPath, findBundledPaperReadingSkill());
  assert.strictEqual(captured.model, "gpt-5.4");
  assert.strictEqual(captured.reasoningEffort, "high");
  assert.strictEqual(captured.pythonPath, pythonPath);
  assert.deepStrictEqual(captured.pythonReadRoots, [pythonRoot]);
  clearTimeout(job.watchdog);
  job.watchdog = null;
  job.state = "canceled";
});
