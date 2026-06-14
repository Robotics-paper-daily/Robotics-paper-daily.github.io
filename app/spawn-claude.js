// Resolve the local Claude Code binary and spawn a headless paper-reading run.
//
// Auth: we deliberately do NOT set ANTHROPIC_API_KEY — the CLI uses the user's
// on-disk login (subscription / OAuth), which the stream-json probe confirmed
// as apiKeySource:"none". The skill lives in the vault's
// .claude/skills/paper-reading, so cwd MUST be the vault for it to be found.
//
// Windows: claude is shipped as a real native claude.exe (the npm `claude.cmd`
// shim just calls it), so we spawn the .exe directly with an argv ARRAY and
// shell:false — no .cmd EINVAL, no shell-injection surface. macOS/Linux: a
// native `claude` on PATH (resolved via a login shell because GUI-launched
// Electron doesn't inherit the terminal PATH).

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function existing(p) {
  try {
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
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
      const prefix = execSync("npm prefix -g", { encoding: "utf8" }).trim();
      candidates.push(
        path.join(prefix, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
      );
    } catch {}
    for (const c of candidates) if (existing(c)) return c;
    // Last resort: locate the .cmd shim and read the claude.exe path out of it.
    try {
      const lines = execSync("where.exe claude", { encoding: "utf8" })
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
    const p = execSync(`${shell} -lic 'command -v claude'`, { encoding: "utf8" }).trim();
    if (existing(p)) return p;
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

// The prompt names the skill + passes the arxiv url so the skill triggers
// deterministically, and explicitly neutralizes the skill's "overwrite this
// duplicate?" question (which would hang a headless run with no answerer).
function buildPrompt(url) {
  return (
    "Use the paper-reading skill to deep-read this paper and write the " +
    "structured Obsidian note: " +
    url +
    "\nIf a note for this arxiv id already exists, OVERWRITE it without asking." +
    "\nDo not ask me any questions. Proceed end to end and finish by printing " +
    "the final note's absolute path."
  );
}

function buildArgv({ url, model, permissionMode, maxBudgetUsd }) {
  const argv = [
    "-p",
    buildPrompt(url),
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

// Spawn the read. Returns the ChildProcess (stdout = stream-json NDJSON).
function spawnRead({ claudePath, vaultPath, url, model, permissionMode, maxBudgetUsd }) {
  const argv = buildArgv({ url, model, permissionMode, maxBudgetUsd });
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // force subscription auth, never API-key billing
  const child = spawn(claudePath, argv, {
    cwd: vaultPath,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32", // own process group for tree-kill on *nix
    env,
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

module.exports = { resolveClaudePath, buildPrompt, buildArgv, spawnRead };
