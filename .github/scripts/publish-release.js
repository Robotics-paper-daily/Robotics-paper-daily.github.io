"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

function releaseTarget(version, env) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid stable package version");
  const tag = `v${version}`;
  if (env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === `refs/tags/${tag}`) {
    return { version, tag, publish: true };
  }
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") throw new Error("Release tag must match package version");
  const publish = env.PUBLISH_RELEASE === "true";
  if (publish && env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Manual release publication must run from main; other branches support build-only runs");
  }
  return { version, tag, publish };
}

function installerNames(version) {
  return [
    `PaperReader-${version}-arm64.dmg`,
    `PaperReader-${version}-x64.dmg`,
    `PaperReader-${version}-x64-Setup.exe`,
  ];
}

function verifyArtifacts(dir, version, expectedManifest) {
  const names = installerNames(version);
  const manifest = fs.readFileSync(path.join(dir, "SHA256SUMS.txt"), "utf8");
  if (expectedManifest !== undefined && manifest !== expectedManifest) {
    throw new Error("Downloaded checksum manifest differs from this build");
  }
  const entries = manifest.trim().split(/\r?\n/).map(line => {
    const match = line.match(/^([a-f\d]{64}) [ *](\S+)$/i);
    if (!match) throw new Error("Invalid checksum manifest line");
    return { hash: match[1].toLowerCase(), name: match[2] };
  });
  if (entries.length !== names.length || names.some(name => entries.filter(e => e.name === name).length !== 1)) {
    throw new Error("Checksum manifest must contain exactly the three expected installers");
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (!fs.lstatSync(file).isFile()) throw new Error(`Installer must be a regular file: ${entry.name}`);
    const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (hash !== entry.hash) throw new Error(`Checksum mismatch: ${entry.name}`);
  }
  return manifest;
}

function buildNotes(body, env) {
  const start = "<!-- paperreader-build:start -->";
  const end = "<!-- paperreader-build:end -->";
  const withoutBuild = body.replace(/<!-- paperreader-build:start -->[\s\S]*?<!-- paperreader-build:end -->/g, "").trim();
  const repoUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}`;
  const runUrl = `${repoUrl}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  return `${withoutBuild}\n\n${start}\n### Current Installer Build\n\n` +
    `All three installers and SHA256SUMS.txt were rebuilt by [GitHub Actions](${runUrl}) ` +
    `from commit [${env.GITHUB_SHA}](${repoUrl}/commit/${env.GITHUB_SHA}).\n\n` +
    "The macOS apps use ad-hoc signatures and pass deployment-target and signature checks. " +
    "They have no Developer ID signature or Apple notarization. These checks do not replace full workflow testing on older macOS versions.\n\n" +
    "Rebuilding an existing release does not move its tag. The source archives attached by GitHub still describe that tag; " +
    `the commit linked above is the source of these installers.\n${end}\n`;
}

function publishRelease({ version, env = process.env, artifactsDir, notes, run } = {}) {
  const target = releaseTarget(version, env);
  if (!target.publish) throw new Error("This run is build-only");
  if (!/^[a-f\d]{40}$/i.test(env.GITHUB_SHA || "") || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || "")) {
    throw new Error("Invalid build commit or repository");
  }
  const gh = run || (args => execFileSync("gh", args, {
    encoding: "utf8", stdio: "pipe", maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60_000,
  }));
  const manifest = verifyArtifacts(artifactsDir, version);
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    const main = JSON.parse(gh(["api", `repos/${env.GITHUB_REPOSITORY}/git/ref/heads/main`]));
    if (main.object.sha !== env.GITHUB_SHA) throw new Error("main has changed since this run started; start a new run from main");
  }
  // A failed API lookup must abort, never be treated as an absent release.
  const pages = JSON.parse(gh(["api", `repos/${env.GITHUB_REPOSITORY}/releases`, "--paginate", "--slurp"]));
  const existing = pages.flat().find(release => release.tag_name === target.tag);
  if (existing && (existing.immutable || existing.prerelease)) {
    throw new Error("Cannot replace an immutable or prerelease release; publish a new stable version");
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-release-"));
  const names = [...installerNames(version), "SHA256SUMS.txt"];
  const finalNotes = buildNotes(existing ? existing.body || "" : notes, env);
  try {
    const notesFile = path.join(temp, "release-notes.md");
    fs.writeFileSync(notesFile, finalNotes);
    if (!existing) {
      gh(["release", "create", target.tag, "--draft", "--target", env.GITHUB_SHA, "--title", target.tag, "--notes-file", notesFile]);
    }
    gh(["release", "upload", target.tag, ...names.map(name => path.resolve(artifactsDir, name)), "--clobber"]);
    const downloaded = path.join(temp, "downloaded");
    fs.mkdirSync(downloaded);
    gh(["release", "download", target.tag, "--dir", downloaded, ...names.flatMap(name => ["--pattern", name])]);
    verifyArtifacts(downloaded, version, manifest);
    // Refresh a failed draft's target on retry. GitHub ignores this field for
    // existing tags, so rebuilding published versions never moves their tags.
    gh(["release", "edit", target.tag, "--notes-file", notesFile,
      ...(!existing || existing.draft ? ["--target", env.GITHUB_SHA, "--draft=false", "--latest"] : []), "--title", target.tag]);
    return { tag: target.tag, notes: finalNotes };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, "../..");
    const { version } = require(path.join(root, "app/package.json"));
    if (require(path.join(root, "app/package-lock.json")).version !== version) throw new Error("Package and lockfile versions differ");
    if (process.argv[2] === "prepare") {
      const target = releaseTarget(version, process.env);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(target).map(([key, value]) => `${key}=${value}\n`).join(""));
      console.log(`Build ${target.tag} from ${process.env.GITHUB_SHA}; publish=${target.publish}`);
    } else if (process.argv[2] === "publish") {
      const result = publishRelease({ version, artifactsDir: path.join(root, "release-artifacts"), notes: fs.readFileSync(path.join(root, "RELEASES_NOTES.md"), "utf8") });
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Published and downloaded all installers for verification: ${result.tag}\n\nBuild commit: ${process.env.GITHUB_SHA}\n`);
      console.log(`Published and verified ${result.tag}`);
    } else {
      throw new Error("Expected prepare or publish");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { releaseTarget, verifyArtifacts, publishRelease, buildNotes };
