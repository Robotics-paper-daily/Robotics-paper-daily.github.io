"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ALLOWED_SITE_JS,
  REQUIRED_PACKAGED_RESOURCES,
  auditAsar,
  auditPackagedResources,
  auditSourceInputs,
  collectSourceFiles,
  inspectGeneratedReport,
  inspectText,
} = require("../app/release-audit");
const appPackage = require("../app/package.json");

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root, relative, contents = "safe fixture") {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

function createSiteSnapshot(root, dailyContents = "public report") {
  const site = path.join(root, "app", "site");
  write(site, "reports.json", "[]");
  write(site, "daily_html/2026_08_18.html", dailyContents);
  for (const file of ALLOWED_SITE_JS) write(site, `js/${file}`, `// ${file}`);
  return site;
}

function fakeGithubToken() {
  return ["ghp", "A".repeat(30)].join("_");
}

test("source collection starts at repo root, covers release inputs, and prunes build state", (t) => {
  const root = tempDir(t, "paperreader-release-source-");
  const included = [
    "README.md",
    "README_ZH.md",
    "docs/security.md",
    "src/main.py",
    ".github/workflows/build.yml",
    "templates/paper_template.html",
    "test/example.test.js",
    "app/main.js",
    "js/like.js",
    "skills/paper-reading/SKILL.md",
  ];
  const excluded = [
    ".git/config",
    "app/node_modules/dependency/index.js",
    "app/dist/mac/PaperReader.app/Contents/Resources/app.asar",
    "app/site/js/stale.js",
  ];
  for (const relative of [...included, ...excluded]) write(root, relative);

  const actual = new Set(collectSourceFiles(root).map((file) => path.relative(root, file)));
  for (const relative of included) assert.strictEqual(actual.has(relative), true, relative);
  for (const relative of excluded) assert.strictEqual(actual.has(relative), false, relative);
});

test("source audit scans generated public paper text as a release input", (t) => {
  const root = tempDir(t, "paperreader-release-public-data-");
  const token = fakeGithubToken();
  createSiteSnapshot(root);
  write(root, "README.md", "safe release guide");
  for (const relative of [
    "daily_html/2026_08_18.html",
    "daily_json/2026-08-18.json",
    "search_index/2026-08.json",
    "search_index.json",
    "reports.json",
  ]) {
    const file = write(root, relative, token);
    assert.throws(
      () => auditSourceInputs({ rootDir: root, homeDir: "" }),
      /contains a GitHub token/
    );
    fs.writeFileSync(file, "safe public metadata");
  }

  assert.doesNotThrow(() => auditSourceInputs({ rootDir: root, homeDir: "" }));

  write(root, "app/site/daily_html/2026_08_18.html", token);
  assert.throws(
    () => auditSourceInputs({ rootDir: root, homeDir: "" }),
    /app\/site\/daily_html\/2026_08_18\.html contains a GitHub token/
  );
  write(root, "app/site/daily_html/2026_08_18.html", "safe public report");

  write(root, "docs/release.md", token);
  assert.throws(
    () => auditSourceInputs({ rootDir: root, homeDir: "" }),
    /docs\/release\.md contains a GitHub token/
  );
});

test("generated reports reject retired browser credential and WebDAV scripts", () => {
  assert.doesNotThrow(() => inspectGeneratedReport("report.html", '<script src="../js/like.js"></script>'));
  for (const reference of [
    '<script src="../js/webdav.js"></script>',
    '<script src="https://cdn.example/jszip.min.js"></script>',
    '<script src="https://cdn.example/spark-md5.min.js"></script>',
    "sessionStorage decrypted credentials",
  ]) {
    assert.throws(
      () => inspectGeneratedReport("report.html", reference),
      /retired browser credential\/WebDAV writer/
    );
  }
});

test("source audit rejects package-manager and Apple signing credentials without reading them", (t) => {
  const root = tempDir(t, "paperreader-release-forbidden-files-");
  createSiteSnapshot(root);
  for (const relative of [".npmrc", ".pypirc", "Developer.mobileprovision", "AuthKey_fixture.p8"]) {
    const file = write(root, relative, "fixture");
    assert.throws(
      () => auditSourceInputs({ rootDir: root, homeDir: "" }),
      new RegExp(`forbidden source file: ${relative.replace(".", "\\.")}`)
    );
    fs.unlinkSync(file);
  }
});

test("text inspection detects the configured home path without embedding a real path fixture", () => {
  const homeDir = ["", "Users", "release-owner"].join("/");
  const privateFile = [homeDir, "Documents", "private.txt"].join("/");
  assert.throws(
    () => inspectText("fixture", privateFile, { homeDir }),
    /current user's home path/
  );
});

test("text inspection rejects realistic Zotero key literals but permits obvious fixtures", () => {
  // Assemble the detector fixture at runtime so the repository itself never
  // contains a realistic 24-character key-shaped literal.
  const realisticFixture = ["AbCdEfGhIjKl", "MnOpQrStUv12"].join("");
  assert.throws(
    () =>
      inspectText(
        "fixture",
        `const ZOTERO_API_KEY = "${realisticFixture}";`,
        { homeDir: "" }
      ),
    /Zotero API key-shaped literal/
  );
  assert.doesNotThrow(() =>
    inspectText("fixture", 'const API_KEY = "AAAAAAAAAAAAAAAAAAAAAAAA";', {
      homeDir: "",
    })
  );
});

test("ASAR audit enforces the exact site script allowlist and forbidden filenames", () => {
  const cleanEntries = [
    "/package.json",
    ...[...ALLOWED_SITE_JS].map((file) => `/site/js/${file}`),
    "/site/daily_html/2026_08_18.html",
  ];
  const asarApi = {
    listPackage: () => cleanEntries,
    extractFile: () => Buffer.from("safe packaged text"),
  };
  assert.doesNotThrow(() => auditAsar("fixture.asar", asarApi, { homeDir: "" }));

  const forbiddenApi = {
    ...asarApi,
    listPackage: () => [...cleanEntries, "/nested/.npmrc"],
  };
  assert.throws(
    () => auditAsar("fixture.asar", forbiddenApi, { homeDir: "" }),
    /fixture\.asar contains nested\/\.npmrc/
  );
});

test("packaged resource audit requires license, notices, app guide, and bundled skill", (t) => {
  const resources = tempDir(t, "paperreader-release-resources-");
  for (const relative of REQUIRED_PACKAGED_RESOURCES) write(resources, relative);
  assert.doesNotThrow(() => auditPackagedResources(resources, { homeDir: "" }));

  fs.unlinkSync(path.join(resources, "THIRD_PARTY_NOTICES.md"));
  assert.throws(
    () => auditPackagedResources(resources, { homeDir: "" }),
    /missing required resource THIRD_PARTY_NOTICES\.md/
  );
});

test("electron-builder includes public release metadata and excludes local credential files", () => {
  const resources = new Map(appPackage.build.extraResources.map((entry) => [entry.to, entry.from]));
  assert.strictEqual(resources.get("LICENSE"), "../LICENSE");
  assert.strictEqual(resources.get("THIRD_PARTY_NOTICES.md"), "../THIRD_PARTY_NOTICES.md");
  assert.strictEqual(resources.get("README.md"), "README.md");
  assert.strictEqual(resources.get("README_ZH.md"), "README_ZH.md");
  assert.strictEqual(resources.get("skills/paper-reading"), "../skills/paper-reading");

  for (const pattern of [
    "!**/.npmrc",
    "!**/.pypirc",
    "!**/*.mobileprovision",
    "!**/*.p8",
  ]) {
    assert.ok(appPackage.build.files.includes(pattern), pattern);
  }
  assert.strictEqual(Object.hasOwn(appPackage.scripts, "dist:win"), false);
  assert.strictEqual(Object.hasOwn(appPackage.build, "win"), false);

  assert.strictEqual(Object.hasOwn(appPackage, "dependencies"), false);
  assert.strictEqual(Object.hasOwn(appPackage.build, "publish"), false);
  assert.deepStrictEqual(appPackage.build.mac.target, ["dmg"]);
  assert.strictEqual(appPackage.build.mac.identity, null);
  assert.strictEqual(appPackage.build.mac.hardenedRuntime, false);
  assert.strictEqual(appPackage.build.mac.notarize, false);
  assert.strictEqual(appPackage.build.dmg.writeUpdateInfo, false);
});

test("release workflow publishes only unsigned macOS DMGs and checksums", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "build-app.yml"),
    "utf8"
  );
  for (const marker of [
    'CSC_IDENTITY_AUTO_DISCOVERY: "false"',
    "app/dist/*.dmg",
    "app/dist/SHA256SUMS.txt",
    "release-artifacts/PaperReader-${version}-*.dmg",
    "release-artifacts/SHA256SUMS.txt",
  ]) {
    assert.match(workflow, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);
  }
  assert.doesNotMatch(workflow, /electron-updater|latest-mac\.yml|\.blockmap|\.zip/);
  assert.doesNotMatch(workflow, /MAC_CSC|APPLE_(?:ID|APP_SPECIFIC_PASSWORD|TEAM_ID)|codesign --verify|spctl --assess/);
});
