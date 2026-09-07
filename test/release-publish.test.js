"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { releaseTarget, publishRelease, buildNotes } = require("../.github/scripts/publish-release");

const env = {
  GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40), GITHUB_REPOSITORY: "example/paperreader",
  GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
  PUBLISH_RELEASE: "true",
};

test("manual main publishes the package version; build-only never publishes", () => {
  assert.deepEqual(releaseTarget("0.3.1", env), { version: "0.3.1", tag: "v0.3.1", publish: true });
  assert.equal(releaseTarget("0.3.1", { ...env, PUBLISH_RELEASE: "false" }).publish, false);
  assert.throws(() => releaseTarget("0.3.1", { ...env, GITHUB_REF: "refs/heads/dev" }), /main/);
  assert.equal(releaseTarget("0.3.1", { ...env, GITHUB_REF: "refs/heads/dev", PUBLISH_RELEASE: "false" }).publish, false);
});

test("tag runs reject package mismatch and malformed stable versions", () => {
  const tagEnv = { ...env, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v0.3.1" };
  assert.equal(releaseTarget("0.3.1", tagEnv).publish, true);
  assert.throws(() => releaseTarget("0.3.2", tagEnv), /match/);
  assert.throws(() => releaseTarget("0.3.1\nmalformed", env), /version/);
});

function fixture(t, { exists = true, draft = false, corruptDownload = false, failUpload = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-publish-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = ["PaperReader-0.3.1-arm64.dmg", "PaperReader-0.3.1-x64.dmg", "PaperReader-0.3.1-x64-Setup.exe"];
  for (const name of assets) fs.writeFileSync(path.join(root, name), `fixture ${name}`);
  fs.writeFileSync(path.join(root, "SHA256SUMS.txt"), assets.map(name =>
    `${createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex")}  ${name}\n`
  ).join(""));
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === "api" && args[1].endsWith("/releases")) {
      return JSON.stringify([exists ? [{ tag_name: "v0.3.1", body: "Original release notes", draft, prerelease: false, target_commitish: "b".repeat(40) }] : []]);
    }
    if (args[0] === "api" && args[1].endsWith("/git/ref/heads/main")) {
      return JSON.stringify({ object: { sha: env.GITHUB_SHA } });
    }
    if (args[1] === "upload" && failUpload) throw new Error("upload failed");
    if (args[1] === "download") {
      const dest = args[args.indexOf("--dir") + 1];
      for (const name of [...assets, "SHA256SUMS.txt"]) fs.copyFileSync(path.join(root, name), path.join(dest, name));
      if (corruptDownload) fs.appendFileSync(path.join(dest, assets[0]), "wrong artifact");
    }
    return "";
  };
  return { root, assets, calls, run, options: { version: "0.3.1", env, artifactsDir: root, notes: "New release notes", run } };
}

test("existing release replaces exactly all installers and checksums, verifies downloads, and records source", (t) => {
  const f = fixture(t);
  const result = publishRelease(f.options);
  const upload = f.calls.find(args => args[1] === "upload");
  assert.equal(upload[2], "v0.3.1");
  assert.ok(upload.includes("--clobber"));
  assert.deepEqual(upload.filter(arg => arg.startsWith(f.root)).map(file => path.basename(file)).sort(),
    [...f.assets, "SHA256SUMS.txt"].sort());
  assert.equal(f.calls.some(args => args[1] === "create"), false);
  assert.equal(f.calls.find(args => args[1] === "edit").includes("--target"), false);
  assert.ok(f.calls.findIndex(args => args[1] === "download") < f.calls.findIndex(args => args[1] === "edit"));
  assert.match(result.notes, /Original release notes/);
  assert.ok(result.notes.includes(env.GITHUB_SHA));
  assert.match(result.notes, /actions\/runs\/123\/attempts\/1/);
  assert.deepEqual(f.calls.find(args => args[1] === "edit").slice(-2), ["--title", "v0.3.1"]);
});

test("new release starts as draft at the exact build commit and publishes only after verification", (t) => {
  const f = fixture(t, { exists: false });
  publishRelease(f.options);
  const create = f.calls.find(args => args[1] === "create");
  assert.ok(create.includes("--draft"));
  assert.equal(create[create.indexOf("--target") + 1], env.GITHUB_SHA);
  const edit = f.calls.find(args => args[1] === "edit");
  assert.ok(edit.includes("--draft=false"));
});

test("retrying a draft publishes it at the new build commit", (t) => {
  const f = fixture(t, { draft: true });
  publishRelease(f.options);
  assert.equal(f.calls.some(args => args[1] === "create"), false);
  const edit = f.calls.find(args => args[1] === "edit");
  assert.ok(edit.includes("--draft=false"));
  assert.equal(edit[edit.indexOf("--target") + 1], env.GITHUB_SHA);
});

test("corrupt local installers fail before any GitHub operation", (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, f.assets[2]), "changed");
  assert.throws(() => publishRelease(f.options), /checksum/i);
  assert.deepEqual(f.calls, []);
});

for (const failure of [{ corruptDownload: true }, { failUpload: true }]) {
  test(`failed publication does not update success notes: ${JSON.stringify(failure)}`, (t) => {
    const f = fixture(t, failure);
    assert.throws(() => publishRelease(f.options), /checksum|upload failed/i);
    assert.equal(f.calls.some(args => args[1] === "edit"), false);
  });
}

test("an old manual run cannot overwrite attachments after main advances", (t) => {
  const f = fixture(t);
  const run = (args) => args[0] === "api" && args[1].endsWith("/git/ref/heads/main")
    ? JSON.stringify({ object: { sha: "b".repeat(40) } }) : f.run(args);
  assert.throws(() => publishRelease({ ...f.options, run }), /main.*changed/i);
  assert.equal(f.calls.some(args => args[0] === "release"), false);
});

test("GitHub lookup failure cannot create or replace a release", (t) => {
  const f = fixture(t);
  const run = (args) => {
    if (args[0] === "api" && args[1].endsWith("/releases")) throw new Error("GitHub API unavailable");
    return f.run(args);
  };
  assert.throws(() => publishRelease({ ...f.options, run }), /API unavailable/);
  assert.equal(f.calls.some(args => args[0] === "release"), false);
});

test("self-consistent downloads from an older build cannot pass upload verification", (t) => {
  const f = fixture(t);
  const run = (args) => {
    const result = f.run(args);
    if (args[1] === "download") {
      const dir = args[args.indexOf("--dir") + 1];
      const name = f.assets[0];
      fs.writeFileSync(path.join(dir, name), "old build");
      const manifest = path.join(dir, "SHA256SUMS.txt");
      const hash = createHash("sha256").update("old build").digest("hex");
      fs.writeFileSync(manifest, fs.readFileSync(manifest, "utf8").replace(/^[a-f\d]{64}/, hash));
    }
    return result;
  };
  assert.throws(() => publishRelease({ ...f.options, run }), /manifest differs/);
  assert.equal(f.calls.some(args => args[1] === "edit"), false);
});

test("rebuild notes retain human notes and replace previous provenance exactly once", () => {
  const old = buildNotes("Release notes edited by a maintainer", { ...env, GITHUB_SHA: "b".repeat(40) });
  const current = buildNotes(old, env);
  assert.match(current, /^Release notes edited by a maintainer/);
  assert.equal(current.split("<!-- paperreader-build:start -->").length, 2);
  assert.ok(current.includes(env.GITHUB_SHA));
  assert.equal(current.includes("b".repeat(40)), false);
});

test("immutable releases fail before uploads", (t) => {
  const f = fixture(t);
  const run = (args) => args[0] === "api" && args[1].endsWith("/releases")
    ? JSON.stringify([[{ tag_name: "v0.3.1", immutable: true }]]) : f.run(args);
  assert.throws(() => publishRelease({ ...f.options, run }), /immutable/);
  assert.equal(f.calls.some(args => args[0] === "release"), false);
});
