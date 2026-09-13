"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ARTIFACT_NAME, restoreState, extractState, validateResult, stagePublication, finalExitCode } = require("../.github/scripts/arxiv-state");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arxiv-workflow-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function restoration(overrides = {}) {
  const calls = [];
  const run = { id: 9, status: "completed", conclusion: "failure", workflow_id: 7,
    head_branch: "main", head_repository: { id: 11 }, event: "schedule" };
  const artifact = { id: 21, name: ARTIFACT_NAME, expired: false, size_in_bytes: 20,
    created_at: "2026-09-11T00:00:00Z", expires_at: "2026-09-20T00:00:00Z", workflow_run: { id: 9 } };
  const options = { ...overrides };
  const github = {
    rest: { actions: {
      getWorkflow: async () => ({ data: { id: 7 } }),
      getWorkflowRun: async args => { calls.push(["run", args]); return { data: (options.runs || [run]).find(r => r.id === args.run_id) }; },
      listArtifactsForRepo: "artifacts",
      downloadArtifact: async args => {
        calls.push(["download", args]);
        if (options.downloadError) throw options.downloadError;
        return { data: Buffer.from("zip fixture") };
      },
    } },
    paginate: async (method, args) => {
      calls.push(["artifacts", args]);
      if (options.listError) throw options.listError;
      return options.artifacts || [artifact];
    },
  };
  const context = { repo: { owner: "example", repo: "papers" }, runId: 10,
    payload: { repository: { id: 11, default_branch: "main" } } };
  return { run, artifact, calls, args: { github, context, now: Date.parse("2026-09-12T00:00:00Z"),
    runAttempt: 1, core: { info: text => calls.push(["info", text]) }, extract: (archive, dest) => {
      calls.push(["extract", fs.readFileSync(archive, "utf8"), dest]);
      if (options.extractError) throw options.extractError;
    } } };
}

test("restores a failed run's state from the same workflow and default branch", async () => {
  const f = restoration();
  assert.equal(await restoreState(f.args), 9);
  assert.deepEqual(f.calls.find(([kind]) => kind === "download")[1], {
    owner: "example", repo: "papers", artifact_id: 21, archive_format: "zip",
  });
  assert.equal(f.calls.find(([kind]) => kind === "run")[1].run_id, 9);
  assert.ok(f.calls.some(([kind, message]) => kind === "info" && message.includes("failure")));
});

test("ignores other branches, repositories, workflows, PRs, current and incomplete runs", async () => {
  const base = restoration().run;
  const runs = [
    { ...base, head_branch: "feature" }, { ...base, head_repository: { id: 12 } },
    { ...base, workflow_id: 8 }, { ...base, event: "pull_request" },
    { ...base, id: 10 }, { ...base, status: "in_progress" },
  ].map((run, index) => ({ ...run, id: index === 4 ? 10 : 20 + index }));
  const artifact = restoration().artifact;
  const f = restoration({ runs, artifacts: runs.map((run, index) => ({ ...artifact, id: 30 + index, workflow_run: { id: run.id } })) });
  assert.equal(await restoreState(f.args), null);
  assert.equal(f.calls.some(([kind]) => ["download", "extract"].includes(kind)), false);
});

test("uses artifact creation time when an older run was rerun most recently", async () => {
  const base = restoration();
  const f = restoration({ runs: [base.run, { ...base.run, id: 8 }], artifacts: [base.artifact,
    { ...base.artifact, id: 22, workflow_run: { id: 8 }, created_at: "2026-09-11T12:00:00Z" }] });
  assert.equal(await restoreState(f.args), 8);
  assert.equal(f.calls.find(([kind]) => kind === "download")[1].artifact_id, 22);
});

test("rerunning a failed workflow can restore its own previous attempt", async () => {
  const base = restoration();
  const f = restoration({ runs: [{ ...base.run, id: 10, status: "in_progress", conclusion: null }],
    artifacts: [{ ...base.artifact, workflow_run: { id: 10 } }] });
  assert.equal(await restoreState({ ...f.args, runAttempt: 2 }), 10);
});

test("missing and expired artifacts allow a fresh start", async () => {
  const base = restoration().artifact;
  for (const artifacts of [[], [{ ...base, expired: true }], [{ ...base, expires_at: "2026-09-11T00:00:00Z" }]]) {
    const f = restoration({ artifacts });
    assert.equal(await restoreState(f.args), null);
    assert.equal(f.calls.some(([kind]) => kind === "download"), false);
  }
});

test("permission, download and corrupt-state errors do not silently discard progress", async () => {
  for (const key of ["listError", "downloadError", "extractError"]) {
    const f = restoration({ [key]: new Error(`${key} failed`) });
    await assert.rejects(restoreState(f.args), new RegExp(`${key} failed`));
  }
});

test("ZIP extraction accepts only JSON state and snapshots and rejects traversal, secrets, links and corruption", t => {
  const root = tempDir(t);
  const archive = path.join(root, "state.zip");
  const writeZip = entries => execFileSync("python3", ["-c", String.raw`
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    for name, content, link in json.loads(sys.argv[2]):
        info = zipfile.ZipInfo(name)
        if link:
            info.external_attr = 0o120777 << 16
        z.writestr(info, content)
`, archive, JSON.stringify(entries)]);
  const valid = [["state.json", '{"schema_version":1}', false], ["snapshots/2026-09-11/category.json", "[]", false]];
  writeZip(valid);
  const validRoot = path.join(root, "valid");
  extractState(archive, validRoot);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(validRoot, "state.json"))), { schema_version: 1 });
  for (const [index, entry] of [
    ["../outside.json", "{}", false], [".env", "SECRET=bad", false],
    ["snapshots/link.json", "{}", true], ["state.json", "invalid JSON", false],
    ["snapshots/../outside.json", "{}", false],
  ].entries()) {
    writeZip(entry[0] === "state.json" ? [entry] : [valid[0], entry]);
    const dest = path.join(root, `bad-${index}`);
    assert.throws(() => extractState(archive, dest));
    assert.equal(fs.existsSync(dest), false);
  }
  assert.equal(fs.existsSync(path.join(root, "outside.json")), false);
});

function result(overrides = {}) {
  return { schema_version: 1, completed_dates: ["2026-09-11"], deferred_dates: [], failures: [],
    publish_ready: true, publish_paths: ["daily_json/2026-09-11.json", "daily_html/2026_09_11.html",
      "reports.json", "search_index.json", "search_index"], exit_code: 0, ...overrides };
}

const deferred = { date: "2026-09-10", reason: "HTTP 429", next_retry_at: "2026-09-12T06:00:00+00:00" };

test("only completed report paths and the associated indexes are staged", t => {
  const root = tempDir(t);
  const manifest = result({ deferred_dates: [deferred], exit_code: 2 });
  for (const relative of [...manifest.publish_paths.filter(p => p !== "search_index"), "search_index/manifest.json",
    "daily_json/2026-09-10.json", "src/main.py"]) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), "fixture");
  }
  const calls = [];
  assert.equal(stagePublication(manifest, { root, git: args => { calls.push(args); return ""; } }), true);
  assert.deepEqual(calls[1], ["add", "-A", "--", ...manifest.publish_paths]);
  assert.equal(calls[1].includes("daily_json/2026-09-10.json"), false);
  assert.equal(calls[1].includes("src/main.py"), false);
});

test("publication rejects incomplete dates, path injection, missing indexes and mixed staged changes", t => {
  for (const file of ["daily_json/2026-09-10.json", "src/main.py", "../secret", "--all", "daily_json/*"]) {
    assert.throws(() => validateResult(result({ publish_paths: [...result().publish_paths, file] })), /unapproved/);
  }
  assert.throws(() => validateResult(result({ publish_paths: ["daily_json/2026-09-11.json"] })), /complete/);
  assert.throws(() => validateResult(result({ publish_ready: false })), /Incomplete/);
  assert.throws(() => stagePublication(result(), { root: tempDir(t), git: () => "src/main.py\n" }), /unrelated staged/);
});

test("symlinked publication ancestors cannot stage files outside the checkout", t => {
  const root = tempDir(t);
  fs.symlinkSync(os.tmpdir(), path.join(root, "daily_json"));
  assert.throws(() => stagePublication(result(), { root, git: () => "" }), /symbolic link/);
});

test("deferred and failed processing never become green even when some reports can publish", () => {
  assert.equal(finalExitCode(result({ deferred_dates: [deferred], exit_code: 2 }), "failure"), 2);
  assert.equal(finalExitCode(result({ failures: [{ date: "2026-09-10", reason: "scoring failed" }], exit_code: 1 }), "failure"), 1);
  assert.equal(finalExitCode(result(), "failure"), 1);
  assert.equal(finalExitCode(result(), "success"), 0);
  assert.throws(() => validateResult(result({ deferred_dates: [deferred] })), /hides incomplete/);
});

test("workflow saves failed-run progress, uses three daily opportunities and publishes the verified list", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/daily_arxiv.yml"), "utf8");
  assert.match(workflow, /cron: '23 0,6,12 \* \* \*'/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /always\(\).*steps\.restore\.outcome == 'success'/);
  assert.match(workflow, /arxiv-state\.js stage/);
  assert.match(workflow, /arxiv-state\.js finish/);
  assert.match(workflow, /retention-days: 14/);
  assert.doesNotMatch(workflow, /git add -A -- daily_json\//);
  assert.doesNotMatch(workflow, /actions\/cache/);
});
