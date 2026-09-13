"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ARTIFACT_NAME = "arxiv-fetch-state-v1";
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

// Use the standard ZIP reader, validate every entry before writing anything,
// and extract into a fresh directory. Never unpack paths supplied by ZIP blindly.
const EXTRACT_STATE = String.raw`
import json, pathlib, re, shutil, stat, sys, zipfile
archive, destination = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(archive) as z:
    entries = z.infolist()
    if len(entries) > 10000 or sum(i.file_size for i in entries) > 100 * 1024 * 1024:
        raise ValueError("State archive exceeds limits")
    names = set()
    for entry in entries:
        name = entry.filename
        mode = entry.external_attr >> 16
        if name in names or stat.S_ISLNK(mode) or entry.flag_bits & 1:
            raise ValueError("Duplicate, encrypted or linked state entry")
        names.add(name)
        if entry.is_dir():
            if not re.fullmatch(r"snapshots(?:/[A-Za-z0-9_.-]+)*/", name):
                raise ValueError("Unexpected state directory")
        elif name != "state.json" and not re.fullmatch(r"snapshots/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*\.json", name):
            raise ValueError("Unexpected state file")
        if ".." in pathlib.PurePosixPath(name).parts or "\\" in name or name.startswith("/"):
            raise ValueError("Unsafe state path")
        if entry.file_size > 25 * 1024 * 1024:
            raise ValueError("State entry exceeds limits")
    if "state.json" not in names:
        raise ValueError("State manifest missing")
    for entry in entries:
        if entry.is_dir():
            continue
        data = z.read(entry)  # verifies CRC, including for zero-length entries
        json.loads(data)
        target = destination / entry.filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
`;

function extractState(archive, stateDir) {
  const target = path.resolve(stateDir);
  if (fs.existsSync(target)) throw new Error("State restore destination already exists");
  const temporary = fs.mkdtempSync(path.join(path.dirname(target), ".arxiv-restore-"));
  try {
    execFileSync("python3", ["-c", EXTRACT_STATE, archive, temporary], { stdio: "pipe", timeout: 60_000 });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function restoreState({ github, context, core, stateDir = ".arxiv-state", now = Date.now(),
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1), extract = extractState }) {
  const repo = context.repo;
  const repository = context.payload.repository;
  const branch = repository.default_branch;
  const { data: workflow } = await github.rest.actions.getWorkflow({ ...repo, workflow_id: "daily_arxiv.yml" });
  // Artifact creation time matters: rerunning an older run can produce the
  // newest saved state. Run creation order alone would restore stale progress.
  const artifacts = await github.paginate(github.rest.actions.listArtifactsForRepo,
    { ...repo, name: ARTIFACT_NAME, per_page: 100 });
  const candidates = artifacts.filter(artifact => artifact.name === ARTIFACT_NAME && !artifact.expired &&
    Date.parse(artifact.expires_at) > now).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  let selected;
  for (const artifact of candidates) {
    const runId = artifact.workflow_run?.id;
    if (!Number.isSafeInteger(runId) || (runId === context.runId && runAttempt <= 1)) continue;
    const { data: run } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: runId });
    // On a rerun, restore executes before uploading anything for this attempt;
    // an existing artifact on the current run therefore belongs to an earlier attempt.
    const previousAttempt = runId === context.runId && runAttempt > 1;
    if ((!previousAttempt && run.status !== "completed") || run.workflow_id !== workflow.id ||
        run.head_branch !== branch || run.head_repository?.id !== repository.id ||
        !["schedule", "workflow_dispatch"].includes(run.event)) continue;
    if (!Number.isFinite(Date.parse(artifact.created_at))) throw new Error("Invalid state artifact creation time");
    selected = { artifact, run };
    break;
  }
  if (!selected) {
    core.info("No unexpired state artifact from this workflow on the default branch; starting without saved state.");
    return null;
  }
  if (selected.artifact.size_in_bytes > MAX_ARCHIVE_BYTES) throw new Error("State archive exceeds download limit");
  // Authentication, API and corrupt ZIP errors intentionally propagate. Only an
  // actually absent/expired artifact permits starting without saved progress.
  const { data } = await github.rest.actions.downloadArtifact({ ...repo, artifact_id: selected.artifact.id, archive_format: "zip" });
  const bytes = Buffer.from(data);
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES) throw new Error("Invalid state archive size");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "arxiv-download-"));
  try {
    const archive = path.join(temporary, "state.zip");
    fs.writeFileSync(archive, bytes);
    extract(archive, stateDir);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  core.info(`Restored arXiv state from run ${selected.run.id} (${selected.run.conclusion}).`);
  return selected.run.id;
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function validateResult(result) {
  if (!result || result.schema_version !== 1 || typeof result.publish_ready !== "boolean" ||
      ![0, 1, 2].includes(result.exit_code) || !Array.isArray(result.failures) ||
      !Array.isArray(result.publish_paths)) throw new Error("Invalid run result manifest");
  if (!Array.isArray(result.completed_dates) || !result.completed_dates.every(validDate) ||
      new Set(result.completed_dates).size !== result.completed_dates.length) throw new Error("Invalid completed_dates");
  if (!Array.isArray(result.deferred_dates) || result.deferred_dates.some(item => !item || !validDate(item.date) ||
      typeof item.reason !== "string" || !Number.isFinite(Date.parse(item.next_retry_at)))) throw new Error("Invalid deferred_dates");
  const deferredDates = result.deferred_dates.map(item => item.date);
  if (new Set(deferredDates).size !== deferredDates.length || result.completed_dates.some(date => deferredDates.includes(date)) ||
      (result.exit_code === 0 && (result.deferred_dates.length || result.failures.length))) {
    throw new Error("Run result hides incomplete work");
  }
  const allowed = new Set(["reports.json", "search_index.json", "search_index", ...result.completed_dates.flatMap(date =>
    [`daily_json/${date}.json`, `daily_html/${date.replaceAll("-", "_")}.html`])]);
  if (new Set(result.publish_paths).size !== result.publish_paths.length || result.publish_paths.some(file => !allowed.has(file))) {
    throw new Error("Run result contains an unapproved publication path");
  }
  if (!result.publish_ready && result.publish_paths.length) throw new Error("Incomplete publication contains paths");
  if (result.publish_ready && (!result.completed_dates.length || result.publish_paths.length !== allowed.size)) {
    throw new Error("Publication must include complete reports and indexes");
  }
  return result;
}

function assertRegularTree(file) {
  const stat = fs.lstatSync(file);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(file)) assertRegularTree(path.join(file, name));
  } else if (!stat.isFile()) throw new Error(`Publication contains a nonregular file: ${file}`);
}

function stagePublication(result, { root = process.cwd(), git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }) } = {}) {
  validateResult(result);
  if (!result.publish_ready) return false;
  if (git(["diff", "--cached", "--name-only"]).trim()) throw new Error("Refusing publication with unrelated staged changes");
  for (const relative of result.publish_paths) {
    // Check parent directories too; lstat on the leaf alone follows parent links.
    let current = root;
    for (const part of relative.split("/")) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Publication path crosses a symbolic link");
    }
    assertRegularTree(current);
  }
  git(["add", "-A", "--", ...result.publish_paths]);
  return true;
}

function finalExitCode(result, fetchOutcome) {
  validateResult(result);
  if (fetchOutcome !== "success" && result.exit_code === 0) return 1;
  return result.exit_code;
}

if (require.main === module) {
  try {
    const result = JSON.parse(fs.readFileSync(".arxiv-run/result.json", "utf8"));
    if (process.argv[2] === "stage") {
      const publish = stagePublication(result);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
    } else if (process.argv[2] === "finish") {
      const code = finalExitCode(result, process.env.FETCH_OUTCOME);
      console.log(`Completed: ${result.completed_dates.length}; deferred: ${result.deferred_dates.length}; failures: ${result.failures.length}.`);
      process.exitCode = code;
    } else throw new Error("Expected stage or finish command");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { ARTIFACT_NAME, restoreState, extractState, validateResult, stagePublication, finalExitCode };
