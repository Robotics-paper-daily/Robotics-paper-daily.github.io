const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runBackgroundTask } = require("../app/background-task");

function removeTree(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("scanReadPapers returns the real vault scan result from a worker", async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-background-vault-"));
  t.after(() => removeTree(vault));

  const noteDir = path.join(vault, "2026-08-14", "Worker Threads for PaperReader");
  fs.mkdirSync(noteDir, { recursive: true });
  fs.writeFileSync(path.join(noteDir, "2608.01234v2.pdf"), "test pdf");
  fs.writeFileSync(
    path.join(noteDir, "Worker Threads for PaperReader.md"),
    "# Worker Threads for PaperReader\n\n---\n- [x] ✅ 已读\n"
  );

  const result = await runBackgroundTask("scanReadPapers", { vaultPath: vault });

  assert.deepStrictEqual(result, {
    "2608.01234": {
      rel: "2026-08-14/Worker Threads for PaperReader/Worker Threads for PaperReader",
      read: true,
    },
  });
});

test("sweepCache performs startup cleanup without blocking the caller", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-background-cache-"));
  t.after(() => removeTree(root));
  const cacheDir = path.join(root, "paper-cache");
  const stale = path.join(cacheDir, "paper-reading", "stale");
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, "partial.txt"), "partial");

  const result = await runBackgroundTask("sweepCache", { cacheDir });

  assert.ok(result.dirs >= 1);
  assert.strictEqual(fs.existsSync(stale), false);
});

test("probeEnv returns the real environment result from a worker", async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-background-probe-"));
  t.after(() => removeTree(vault));
  fs.mkdirSync(path.join(vault, ".obsidian"));

  const result = await runBackgroundTask("probeEnv", {
    provider: "trae",
    vaultPath: vault,
    traePath: process.execPath,
  });

  assert.strictEqual(result.provider, "trae");
  assert.strictEqual(result.vault.path, fs.realpathSync.native(vault));
  assert.strictEqual(result.vault.ok, true);
  assert.strictEqual(result.trae.path, process.execPath);
  assert.strictEqual(result.trae.ok, true);
  // CI intentionally does not install the optional paper-reading Python
  // requirements before Node tests. The worker must report that host state,
  // while deterministic fitz success/failure behavior is covered by the
  // injected unit tests in env-probe.test.js.
  assert.strictEqual(typeof result.python.ok, "boolean");
  assert.strictEqual(typeof result.python.fitzOk, "boolean");
  assert.strictEqual(result.ready, result.vault.ok && result.cli.ok && result.python.ok);
});

test("detectDefaults returns the environment probe shape from a worker", async () => {
  const result = await runBackgroundTask("detectDefaults");

  assert.strictEqual(typeof result, "object");
  assert.strictEqual(typeof result.vaultPath, "string");
  assert.strictEqual(typeof result.codexPath, "string");
  assert.strictEqual(typeof result.claudePath, "string");
  assert.strictEqual(typeof result.traePath, "string");
});

test("blocking model discovery does not block the caller event loop", async (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-background-models-"));
  const previousCwd = process.cwd();
  t.after(() => {
    process.chdir(previousCwd);
    removeTree(fixture);
  });

  // listModels always invokes `<binary> models --json`. Point it at Node and
  // make `models` a deliberately slow JavaScript entry point in the worker's
  // inherited cwd. This exercises the real synchronous child-process path.
  fs.writeFileSync(
    path.join(fixture, "models"),
    [
      "const wait = new Int32Array(new SharedArrayBuffer(4));",
      "Atomics.wait(wait, 0, 0, 250);",
      'process.stdout.write(JSON.stringify([{name:"fixture-model",_meta:{trae:{load:{percent:12}}}}]));',
    ].join("\n")
  );
  process.chdir(fixture);

  let settled = false;
  let heartbeats = 0;
  const interval = setInterval(() => {
    heartbeats += 1;
  }, 10);
  const pending = runBackgroundTask("listTraeModels", { traePath: process.execPath }).finally(() => {
    settled = true;
    clearInterval(interval);
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(settled, false, "fixture task should still be doing blocking work");
  assert.ok(heartbeats >= 2, `main event loop only produced ${heartbeats} heartbeat(s)`);

  const result = await pending;
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.models[0].name, "fixture-model");
  assert.strictEqual(result.models[0].load, 12);
});

test("unknown task names reject without creating a worker", async () => {
  await assert.rejects(runBackgroundTask("deleteEverything", {}), (error) => {
    assert.strictEqual(error.name, "BackgroundTaskError");
    assert.strictEqual(error.code, "BACKGROUND_TASK_UNKNOWN");
    assert.match(error.message, /deleteEverything/);
    return true;
  });
});

test("background tasks have a terminating deadline", async () => {
  await assert.rejects(
    runBackgroundTask("detectDefaults", undefined, { timeoutMs: 1 }),
    (error) => {
      assert.strictEqual(error.name, "BackgroundTaskError");
      assert.strictEqual(error.code, "BACKGROUND_TASK_TIMEOUT");
      return true;
    }
  );
});

test("background task deadlines reject invalid values before creating a worker", async () => {
  await assert.rejects(
    runBackgroundTask("probeEnv", {}, { timeoutMs: 0 }),
    /timeoutMs must be a positive number/
  );
});

test("Electron main routes blocking button prerequisites through background workers", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "app", "main.js"), "utf8");
  assert.match(main, /require\("\.\/background-task"\)/);
  for (const task of ["detectDefaults", "probeEnv", "listTraeModels", "scanReadPapers", "sweepCache"]) {
    assert.match(main, new RegExp(`(?:runBackgroundTask|cachedBackgroundTask)\\([\\s\\S]{0,180}["']${task}["']`));
  }
  assert.doesNotMatch(main, /require\("\.\/env-probe"\)/);
  assert.doesNotMatch(main, /require\("\.\/vault-scan"\)/);
  assert.doesNotMatch(main, /listModels:\s*listTraeModels|\blistTraeModels\(/);
  assert.match(main, /app\.getPath\("userData"\)[\s\S]{0,100}"paper-cache"/);
  assert.match(main, /runBackgroundTask\("sweepCache", \{ cacheDir: paperCacheDir \}\)/);
  assert.doesNotMatch(main, /runBackgroundTask\("sweepCache", \{ vaultPath/);
  assert.match(main, /cachedBackgroundTask\([\s\S]{0,180}"probeEnv"/);
  assert.match(
    main,
    /patch\.provider = d\.codexPath[\s\S]{0,160}\? "codex"[\s\S]{0,160}d\.claudePath[\s\S]{0,160}\? "claude"[\s\S]{0,160}d\.traePath[\s\S]{0,160}\? "trae"[\s\S]{0,160}: "codex"/
  );
});

test("worker task errors are returned as safe Error objects", async () => {
  await assert.rejects(runBackgroundTask("listTraeModels", null), (error) => {
    assert.ok(error instanceof Error);
    assert.strictEqual(error.name, "TypeError");
    assert.strictEqual(error.code, "BACKGROUND_TASK_FAILED");
    assert.strictEqual(typeof error.stack, "string");
    return true;
  });
});
