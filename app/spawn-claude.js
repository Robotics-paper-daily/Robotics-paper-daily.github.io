// Resolve the local Claude Code binary and spawn a headless paper-reading run.
//
// Auth: we deliberately do NOT set ANTHROPIC_API_KEY — the CLI uses the user's
// on-disk login (subscription / OAuth), which the stream-json probe confirmed
// as apiKeySource:"none". The skill is bundled outside the vault; its exact
// SKILL.md path is placed in the prompt while cwd remains the notes vault.
//
// Windows: claude is shipped as a real native claude.exe (the npm `claude.cmd`
// shim just calls it), so we spawn the .exe directly with an argv ARRAY and
// shell:false — no .cmd EINVAL, no shell-injection surface. macOS/Linux: a
// native `claude` on PATH (resolved via a login shell because GUI-launched
// Electron doesn't inherit the terminal PATH).

const { spawn, execSync, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { normalizeAppCacheDir } = require("./cache-clean");

function existing(p) {
  try {
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

// The login shell's PATH (homebrew/uv/conda/pyenv/etc.), computed once. A
// Finder/.app-launched Electron only inherits a minimal PATH, so we recover the
// user's real PATH the same way resolveClaudePath finds claude — via a login
// shell. Cached because this spawns a shell.
let _loginPathCache;
function loginShellPath() {
  if (_loginPathCache !== undefined) return _loginPathCache;
  _loginPathCache = "";
  try {
    const shell = process.env.SHELL || "/bin/sh";
    _loginPathCache = execFileSync(shell, ["-lic", 'printf %s "$PATH"'], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {}
  return _loginPathCache;
}

// Build a PATH for the spawned claude (macOS/Linux) so its OWN subprocesses
// (python/uv/git the skill runs) resolve even under a GUI-minimal PATH. Purely
// additive + de-duped — never drops an entry the process already had.
function enrichedPath(claudePath, currentPath) {
  const home = process.env.HOME || "";
  const segs = [currentPath, loginShellPath(), claudePath && path.dirname(claudePath)]
    .concat([
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      home && path.join(home, ".local", "bin"),
      home && path.join(home, ".npm-global", "bin"),
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ])
    .filter(Boolean)
    .join(":")
    .split(":");
  const seen = new Set();
  const out = [];
  for (const s of segs) if (s && !seen.has(s)) (seen.add(s), out.push(s));
  return out.join(":");
}

function resolveClaudePath(override) {
  const ov = existing(override);
  if (ov) return ov;

  if (process.platform === "win32") {
    const candidates = [];
    if (process.env.APPDATA) {
      candidates.push(
        path.join(
          process.env.APPDATA,
          "npm",
          "node_modules",
          "@anthropic-ai",
          "claude-code",
          "bin",
          "claude.exe"
        )
      );
    }
    try {
      const prefix = execSync("npm prefix -g", {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      candidates.push(
        path.join(prefix, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
      );
    } catch {}
    for (const c of candidates) if (existing(c)) return c;
    // Last resort: locate the .cmd shim and read the claude.exe path out of it.
    try {
      const lines = execSync("where.exe claude", {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split(/\r?\n/);
      for (const line of lines) {
        if (line.toLowerCase().endsWith(".exe") && existing(line)) return line;
        if (line.toLowerCase().endsWith(".cmd")) {
          const shim = fs.readFileSync(line, "utf8");
          const m = shim.match(/"%dp0%\\?([^"]*claude\.exe)"|"([^"]*claude\.exe)"/i);
          const rel = m && (m[1] || m[2]);
          if (rel) {
            const abs = path.isAbsolute(rel) ? rel : path.join(path.dirname(line), rel);
            if (existing(abs)) return abs;
          }
        }
      }
    } catch {}
    return null;
  }

  // macOS / Linux
  try {
    const shell = process.env.SHELL || "/bin/sh";
    const p = execFileSync(shell, ["-lic", "command -v claude"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (existing(p)) return p;
  } catch {}
  // npm global prefix (covers nvm / asdf / custom prefixes the static list misses)
  try {
    const prefix = execSync("npm prefix -g", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const c = path.join(prefix, "bin", "claude");
    if (existing(c)) return c;
  } catch {}
  for (const c of [
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    process.env.HOME && path.join(process.env.HOME, ".npm-global", "bin", "claude"),
    process.env.HOME && path.join(process.env.HOME, ".local", "bin", "claude"),
  ]) {
    if (existing(c)) return c;
  }
  return null;
}

function exactSkillPath(skillPath) {
  if (
    typeof skillPath !== "string" ||
    !path.isAbsolute(skillPath) ||
    path.basename(skillPath).toLowerCase() !== "skill.md"
  ) {
    throw new TypeError("an absolute bundled paper-reading SKILL.md path is required");
  }
  return skillPath;
}

// The prompt gives Claude the exact bundled skill path because a headless `-p`
// run does not reliably discover skills outside cwd. It also neutralizes the
// skill's duplicate question, which would otherwise wait for an answer forever.
function buildPrompt(arg) {
  const { url, query, skillPath } = typeof arg === "string" ? { url: arg } : arg || {};
  const skill = exactSkillPath(skillPath);
  const prefix =
    "First read and follow the paper-reading skill instructions from this exact file:\n" +
    skill +
    "\nResolve every relative script or resource path from that skill's directory. ";
  if (query && !url) {
    // Name/title only — let Claude locate the paper on arXiv first, then read it.
    return (
      prefix +
      "Deep-read a paper and write the structured " +
      'Obsidian note. The paper is given by name/description, not a link:\n"' +
      query +
      '"\nFirst find the paper on arXiv (search the web / arxiv for its abstract ' +
      "page and id), then deep-read THAT paper. If you cannot confidently identify " +
      "a single matching paper, stop and say so instead of guessing." +
      "\nIf a note for this arxiv id already exists, OVERWRITE it without asking." +
      "\nDo not ask me any questions. Proceed end to end and finish by printing " +
      "the final note's absolute path."
    );
  }
  return (
    prefix +
    "Deep-read this paper and write the " +
    "structured Obsidian note: " +
    url +
    "\nIf a note for this arxiv id already exists, OVERWRITE it without asking." +
    "\nDo not ask me any questions. Proceed end to end and finish by printing " +
    "the final note's absolute path."
  );
}

function buildArgv({ url, query, skillPath, model, permissionMode, maxBudgetUsd }) {
  const argv = [
    "-p",
    buildPrompt({ url, query, skillPath }),
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    permissionMode || "bypassPermissions",
  ];
  if (model) argv.push("--model", model);
  if (maxBudgetUsd && maxBudgetUsd > 0) argv.push("--max-budget-usd", String(maxBudgetUsd));
  return argv;
}

function spawnEnvironment(claudePath, cacheDir, pythonPath, baseEnv = process.env) {
  const ownedCacheDir = normalizeAppCacheDir(cacheDir);
  if (!ownedCacheDir) throw new TypeError("a valid app-owned paper-cache directory is required");
  if (typeof pythonPath !== "string" || !path.isAbsolute(pythonPath)) {
    throw new TypeError("an absolute probed Python executable is required");
  }
  const env = {
    ...baseEnv,
    PAPERREADER_CACHE_DIR: ownedCacheDir,
    PAPERREADER_PYTHON: path.resolve(pythonPath),
  };
  delete env.ANTHROPIC_API_KEY; // force subscription auth, never API-key billing
  if (process.platform !== "win32") env.PATH = enrichedPath(claudePath, env.PATH);
  return env;
}

// Spawn the read. Returns the ChildProcess (stdout = stream-json NDJSON).
function spawnRead({
  claudePath,
  vaultPath,
  cacheDir,
  skillPath,
  url,
  query,
  model,
  permissionMode,
  maxBudgetUsd,
  pythonPath,
}) {
  const argv = buildArgv({ url, query, skillPath, model, permissionMode, maxBudgetUsd });
  const env = spawnEnvironment(claudePath, cacheDir, pythonPath);
  const child = spawn(claudePath, argv, {
    cwd: vaultPath,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32", // own process group for tree-kill on *nix
    // Close stdin: claude takes its prompt from -p (argv), so an open stdin pipe
    // is never read but can leave the child waiting; mirror spawn-trae.js.
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

module.exports = {
  resolveClaudePath,
  buildPrompt,
  buildArgv,
  spawnRead,
  spawnEnvironment,
  enrichedPath,
};
