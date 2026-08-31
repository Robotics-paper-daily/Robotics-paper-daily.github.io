"use strict";

// Release-time privacy boundary. This checks source inputs from the repository
// root, the generated site snapshot, and packaged ASAR/resources instead of
// trusting gitignore: electron-builder packages files from disk, including
// ignored files, unless the build is explicitly scoped.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_DIR = __dirname;
const ROOT_DIR = path.join(APP_DIR, "..");

const ALLOWED_SITE_JS = new Set([
  "app-rpc.js",
  "like.js",
  "read-paper.js",
  "search-index.js",
  "translate.js",
  "zotero.js",
]);

// These directories are build state or repository internals, not source
// inputs. Match repository-relative paths so similarly named source folders
// elsewhere are not silently skipped.
const SOURCE_PRUNED_DIRS = new Set([
  ".git",
  "app/node_modules",
  "app/dist",
  "app/site",
]);

// Generated paper corpora contain public third-party metadata. Keep their
// paths identifiable for tests/reporting, but scan their text too: generated
// output is still uploaded and packaged, so an accidentally interpolated local
// path or credential must block the release rather than receive an exemption.
const PUBLIC_PAPER_DATA_DIRS = new Set(["daily_html", "daily_json", "search_index"]);
const PUBLIC_PAPER_DATA_FILES = new Set(["reports.json", "search_index.json"]);

const RETIRED_RELEASE_INPUTS = Object.freeze([
  "build_secrets.py",
  "js/secrets.enc.js",
  "js/crypto.js",
  "js/webdav.js",
  "app/vendor/jszip.min.js",
  "app/vendor/spark-md5.min.js",
]);

const RETIRED_REPORT_REFERENCE =
  /(?:spark-md5(?:\.min)?\.js|jszip(?:\.min)?\.js|(?:^|\/)webdav\.js|(?:^|\/)crypto\.js|secrets\.enc\.js|sessionStorage decrypted credentials)/i;

const FORBIDDEN_NAMES = new Set([
  "secrets.enc.js",
  "crypto.js",
  "webdav.js",
  "build_secrets.py",
  "zotero-credentials.secure.json",
  "config.json",
  ".npmrc",
  ".pypirc",
]);

const FORBIDDEN_EXTENSIONS = new Set([".key", ".mobileprovision", ".p8", ".p12", ".pem"]);

const TEXT_EXTENSIONS = new Set([
  ".bat",
  ".cfg",
  ".command",
  ".css",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".py",
  ".sh",
  ".svg",
  ".toml",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const TEXT_BASENAMES = new Set([".gitignore", "LICENSE", "requirements.txt"]);

const REQUIRED_PACKAGED_RESOURCES = Object.freeze([
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "README_ZH.md",
  "skills/paper-reading/SKILL.md",
]);

function fail(message) {
  throw new Error(`[release-audit] ${message}`);
}

function toPosixRelative(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function textMarkers(options = {}) {
  const home = Object.hasOwn(options, "homeDir") ? options.homeDir : os.homedir();
  return [home && { label: "current user's home path", value: home }].filter(Boolean);
}

function inspectText(label, buffer, options = {}) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
  for (const marker of textMarkers(options)) {
    if (text.includes(marker.value)) fail(`${label} contains ${marker.label}`);
  }

  // Zotero personal-library keys are exactly 24 letters/digits and have no
  // vendor prefix that generic secret scanners can recognize. Reject literals
  // in the common assignment/header shapes. Tests may use only an unmistakable
  // single-character placeholder (for example 24 × "A").
  const zoteroKeyLiterals = [
    /\b(?:ZOTERO_)?API_KEY\s*=\s*["']([A-Za-z0-9]{24})["']/gi,
    /["']?(?:apiKey|Zotero-API-Key)["']?\s*:\s*["']([A-Za-z0-9]{24})["']/g,
  ];
  for (const pattern of zoteroKeyLiterals) {
    for (const match of text.matchAll(pattern)) {
      if (!/^([A-Za-z0-9])\1{23}$/.test(match[1])) {
        fail(`${label} contains a Zotero API key-shaped literal`);
      }
    }
  }

  const signatures = [
    { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { label: "GitHub token", pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
    { label: "npm token", pattern: /\bnpm_[A-Za-z0-9]{20,}\b/ },
    { label: "PyPI token", pattern: /\bpypi-[A-Za-z0-9_-]{20,}\b/ },
    { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/ },
    { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    { label: "OpenAI-style secret", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
    { label: "credential-bearing URL", pattern: /https?:\/\/[^/@\s]+:[^/@\s]+@/ },
    {
      label: "absolute macOS user path",
      pattern: /\/Users\/(?!test(?:\/|\b)|alice(?:\/|\b)|example(?:\/|\b)|<username>(?:\/|\b))[^/\s"'<>]+\//,
    },
  ];
  for (const signature of signatures) {
    if (signature.pattern.test(text)) fail(`${label} contains a ${signature.label}`);
  }
}

function inspectGeneratedReport(label, buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
  if (RETIRED_REPORT_REFERENCE.test(text)) {
    fail(`${label} references the retired browser credential/WebDAV writer`);
  }
}

function isForbiddenFile(file) {
  const basename = path.basename(file);
  const lower = basename.toLowerCase();
  return (
    FORBIDDEN_NAMES.has(lower) ||
    FORBIDDEN_EXTENSIONS.has(path.extname(lower)) ||
    /^\.env(?:\.|$)/i.test(basename) ||
    /\.secure\.json$/i.test(basename)
  );
}

function isTextFile(file) {
  const basename = path.basename(file);
  return (
    TEXT_BASENAMES.has(basename) ||
    /^README(?:[_-][^.]+)?(?:\.md)?$/i.test(basename) ||
    TEXT_EXTENSIONS.has(path.extname(basename).toLowerCase())
  );
}

function isPublicPaperData(relative) {
  const normalized = String(relative || "").replaceAll("\\", "/");
  const first = normalized.split("/", 1)[0];
  return PUBLIC_PAPER_DATA_DIRS.has(first) || PUBLIC_PAPER_DATA_FILES.has(normalized);
}

function walkFiles(root, out = [], options = {}) {
  if (!fs.existsSync(root)) return out;
  const baseDir = options.baseDir || root;
  const pruneRelative = options.pruneRelative || new Set();

  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink()) fail(`${root} is a symbolic link`);
  if (rootStat.isFile()) {
    out.push(root);
    return out;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const relative = toPosixRelative(baseDir, full);
    if (entry.isSymbolicLink()) fail(`${full} is a symbolic link`);
    if (entry.isDirectory()) {
      // Prune before entering the directory. This prevents credentials in VCS
      // internals, dependencies, or previous build output from becoming source
      // audit findings while those outputs are checked by their own boundary.
      if (pruneRelative.has(relative)) continue;
      walkFiles(full, out, { baseDir, pruneRelative });
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function collectSourceFiles(rootDir = ROOT_DIR) {
  return walkFiles(rootDir, [], {
    baseDir: rootDir,
    pruneRelative: SOURCE_PRUNED_DIRS,
  });
}

function auditSiteSnapshot(siteDir = path.join(APP_DIR, "site"), options = {}) {
  const expectedTopLevel = new Set(["daily_html", "js", "reports.json"]);
  if (!fs.existsSync(siteDir)) {
    fail("generated app/site snapshot is missing; run npm run sync-site");
  }
  const topLevel = fs.readdirSync(siteDir, { withFileTypes: true });
  const unexpectedTopLevel = topLevel
    .filter(
      (entry) =>
        !expectedTopLevel.has(entry.name) ||
        (["daily_html", "js"].includes(entry.name) && !entry.isDirectory()) ||
        (entry.name === "reports.json" && !entry.isFile())
    )
    .map((entry) => entry.name);
  const missingTopLevel = [...expectedTopLevel].filter(
    (name) => !topLevel.some((entry) => entry.name === name)
  );
  if (unexpectedTopLevel.length || missingTopLevel.length) {
    fail(
      `app/site boundary mismatch (unexpected=${unexpectedTopLevel.join(",") || "none"}; missing=${missingTopLevel.join(",") || "none"})`
    );
  }

  const jsDir = path.join(siteDir, "js");
  const jsEntries = fs.readdirSync(jsDir, { withFileTypes: true });
  const actualJs = jsEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const unexpectedJs = jsEntries
    .filter((entry) => !entry.isFile() || !ALLOWED_SITE_JS.has(entry.name))
    .map((entry) => entry.name);
  const missingJs = [...ALLOWED_SITE_JS].filter((name) => !actualJs.includes(name));
  if (unexpectedJs.length || missingJs.length) {
    fail(
      `app/site/js allowlist mismatch (unexpected=${unexpectedJs.join(",") || "none"}; missing=${missingJs.join(",") || "none"})`
    );
  }

  for (const file of walkFiles(siteDir)) {
    const relative = toPosixRelative(siteDir, file);
    if (isForbiddenFile(file)) fail(`forbidden generated file: ${relative}`);
    if (isTextFile(file)) {
      const contents = fs.readFileSync(file);
      inspectText(`app/site/${relative}`, contents, options);
      if (relative.startsWith("daily_html/")) {
        inspectGeneratedReport(`app/site/${relative}`, contents);
      }
    }
  }
}

function auditSourceInputs(options = {}) {
  const rootDir = path.resolve(options.rootDir || ROOT_DIR);
  for (const relative of RETIRED_RELEASE_INPUTS) {
    if (fs.existsSync(path.join(rootDir, relative))) {
      fail(`retired release input still exists: ${relative}`);
    }
  }

  for (const file of collectSourceFiles(rootDir)) {
    const relative = toPosixRelative(rootDir, file);
    if (path.basename(file) === ".DS_Store") continue;
    if (isForbiddenFile(file)) fail(`forbidden source file: ${relative}`);
    if (isTextFile(file)) {
      const contents = fs.readFileSync(file);
      inspectText(relative, contents, options);
      if (relative.startsWith("daily_html/")) inspectGeneratedReport(relative, contents);
    }
  }

  if (options.auditSite !== false) {
    auditSiteSnapshot(options.siteDir || path.join(rootDir, "app", "site"), options);
  }
}

function findFilesNamed(root, basename, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    // Application bundles legitimately contain framework symlinks. Never
    // follow them while locating package payloads.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) findFilesNamed(full, basename, out);
    else if (entry.isFile() && entry.name === basename) out.push(full);
  }
  return out;
}

function auditAsar(asarPath, asarApi, options = {}) {
  const entries = asarApi.listPackage(asarPath).map((entry) => entry.replace(/^[/\\]+/, ""));
  for (const entry of entries) {
    if (isForbiddenFile(entry)) fail(`${asarPath} contains ${entry}`);
  }

  const jsEntries = entries
    .filter((entry) => entry.startsWith("site/js/") && entry.split("/").length === 3)
    .map((entry) => path.posix.basename(entry));
  const unexpected = jsEntries.filter((name) => !ALLOWED_SITE_JS.has(name));
  const missing = [...ALLOWED_SITE_JS].filter((name) => !jsEntries.includes(name));
  if (unexpected.length || missing.length) fail(`${asarPath} has an invalid site/js allowlist`);

  for (const entry of entries) {
    if (!isTextFile(entry)) continue;
    if (entry.startsWith("node_modules/")) continue;
    inspectText(`${asarPath}:${entry}`, asarApi.extractFile(asarPath, entry), options);
  }
}

function auditPackagedResources(resourcesDir, options = {}) {
  for (const relative of REQUIRED_PACKAGED_RESOURCES) {
    const file = path.join(resourcesDir, relative);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
      fail(`${resourcesDir} is missing required resource ${relative}`);
    }
  }

  for (const relative of ["LICENSE", "THIRD_PARTY_NOTICES.md", "README.md", "README_ZH.md"]) {
    const file = path.join(resourcesDir, relative);
    inspectText(`${resourcesDir}:${relative}`, fs.readFileSync(file), options);
  }

  const skillsDir = path.join(resourcesDir, "skills");
  for (const file of walkFiles(skillsDir)) {
    const relative = toPosixRelative(resourcesDir, file);
    if (isForbiddenFile(file)) fail(`${resourcesDir} contains forbidden resource ${relative}`);
    if (isTextFile(file)) inspectText(`${resourcesDir}:${relative}`, fs.readFileSync(file), options);
  }
}

function auditDist(distDir = path.join(APP_DIR, "dist"), options = {}) {
  let asarApi = options.asarApi;
  if (!asarApi) {
    try {
      asarApi = require("@electron/asar");
    } catch {
      fail("@electron/asar is unavailable; run npm ci before --dist audit");
    }
  }

  const asars = findFilesNamed(distDir, "app.asar");
  if (asars.length !== 2) fail(`expected exactly two packaged app.asar files, found ${asars.length}`);
  for (const asarPath of asars) {
    auditAsar(asarPath, asarApi, options);
    auditPackagedResources(path.dirname(asarPath), options);
  }
}

function main(argv = process.argv.slice(2), options = {}) {
  auditSourceInputs(options);
  if (argv.includes("--dist")) auditDist(options.distDir, options);
  console.log(`[release-audit] passed${argv.includes("--dist") ? " (source + packaged apps)" : " (source)"}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_SITE_JS,
  FORBIDDEN_EXTENSIONS,
  FORBIDDEN_NAMES,
  PUBLIC_PAPER_DATA_DIRS,
  PUBLIC_PAPER_DATA_FILES,
  RETIRED_REPORT_REFERENCE,
  REQUIRED_PACKAGED_RESOURCES,
  RETIRED_RELEASE_INPUTS,
  SOURCE_PRUNED_DIRS,
  auditAsar,
  auditDist,
  auditPackagedResources,
  auditSiteSnapshot,
  auditSourceInputs,
  collectSourceFiles,
  findFilesNamed,
  inspectText,
  inspectGeneratedReport,
  isForbiddenFile,
  isPublicPaperData,
  isTextFile,
  main,
  walkFiles,
};
