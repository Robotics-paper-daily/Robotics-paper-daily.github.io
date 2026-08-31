// Resolve the OpenAI Codex CLI and run one non-interactive paper-reading job.
//
// Authentication stays entirely inside Codex: PaperReader never asks for or
// stores an OpenAI API key. The child inherits the user's normal Codex login.
// A named permission profile denies reads outside minimal runtime paths, the
// bundled skill, and the selected Obsidian vault/App cache workspace roots. The
// two workspace roots remain writable and outbound network access stays enabled
// for paper/repo downloads. Approval prompts are disabled for this headless run.

const { spawn, execSync, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { enrichedPath } = require("./spawn-claude");
const { normalizeAppCacheDir } = require("./cache-clean");

function existing(candidate) {
  try {
    return candidate && fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function windowsNativeFromShim(shimPath) {
  if (!shimPath || process.platform !== "win32") return null;
  const lower = shimPath.toLowerCase();
  if (lower.endsWith(".exe")) return existing(shimPath);
  if (!lower.endsWith(".cmd") && !lower.endsWith(".ps1")) return null;
  const target = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  const platformPackage = process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
  const root = path.dirname(shimPath);
  return existing(
    path.join(
      root,
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      platformPackage,
      "vendor",
      target,
      "bin",
      "codex.exe"
    )
  );
}

function usableCandidate(candidate) {
  const found = existing(candidate);
  if (!found) return null;
  if (process.platform !== "win32") return found;
  return /\.exe$/i.test(found) ? found : windowsNativeFromShim(found);
}

function resolveCodexPath(override) {
  const explicit = usableCandidate(override);
  if (explicit) return explicit;

  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (process.platform === "win32") {
    const candidates = [
      home && path.join(home, ".local", "bin", "codex.exe"),
      process.env.LOCALAPPDATA &&
        path.join(process.env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
      home &&
        path.join(home, ".codex", "packages", "standalone", "current", "bin", "codex.exe"),
      home && path.join(home, ".codex", "packages", "standalone", "current", "codex.exe"),
    ].filter(Boolean);
    try {
      const prefix = execSync("npm prefix -g", {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      candidates.push(path.join(prefix, "codex.exe"), path.join(prefix, "codex.cmd"));
    } catch {}
    try {
      candidates.unshift(
        ...execSync("where.exe codex", {
          encoding: "utf8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "ignore"],
        })
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
      );
    } catch {}
    for (const candidate of candidates) {
      const resolved = usableCandidate(candidate);
      if (resolved) return resolved;
    }
    return null;
  }

  try {
    const shell = process.env.SHELL || "/bin/sh";
    const found = execFileSync(shell, ["-lic", "command -v codex"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (existing(found)) return found;
  } catch {}
  try {
    const prefix = execSync("npm prefix -g", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const candidate = path.join(prefix, "bin", "codex");
    if (existing(candidate)) return candidate;
  } catch {}
  for (const candidate of [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    home && path.join(home, ".local", "bin", "codex"),
  ]) {
    if (existing(candidate)) return candidate;
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

function buildPrompt(arg) {
  const { url, query, skillPath } = typeof arg === "string" ? { url: arg } : arg || {};
  const skill = exactSkillPath(skillPath);
  const prefix =
    "First read and follow the paper-reading skill instructions from this exact file:\n" +
    skill +
    "\nResolve every relative script or resource path from that skill's directory. ";
  if (query && !url) {
    return (
      prefix +
      'Deep-read a paper given by name/description and write its structured Obsidian note:\n"' +
      query +
      '"\nFirst identify the single matching paper on arXiv, then deep-read that paper. ' +
      "If you cannot confidently identify one match, stop instead of guessing. " +
      "If a note for this arXiv id exists, overwrite it without asking. " +
      "Do not ask questions; proceed end to end and finish by printing the final note's absolute path."
    );
  }
  return (
    prefix +
    "Deep-read this paper and write its structured Obsidian note: " +
    url +
    "\nIf a note for this arXiv id exists, overwrite it without asking. " +
    "Do not ask questions; proceed end to end and finish by printing the final note's absolute path."
  );
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function resolveUserHome(env = process.env) {
  const candidate = typeof env.HOME === "string" && env.HOME.trim()
    ? env.HOME.trim()
    : typeof env.USERPROFILE === "string"
      ? env.USERPROFILE.trim()
      : "";
  return candidate && path.isAbsolute(candidate) ? path.resolve(candidate) : null;
}

function resolveCodexHome(env = process.env) {
  const configured = typeof env.CODEX_HOME === "string" ? env.CODEX_HOME.trim() : "";
  const userHome = resolveUserHome(env);
  const candidate = configured || (userHome ? path.join(userHome, ".codex") : "");
  if (!candidate || !path.isAbsolute(candidate)) {
    throw new TypeError("an absolute Codex home is required to protect login material");
  }
  return path.resolve(candidate);
}

function isWithin(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel));
}

function safeReadRoots(values, protectedHome, userHome = null) {
  const roots = [];
  const inferredUserHome = path.basename(protectedHome) === ".codex"
    ? path.dirname(protectedHome)
    : null;
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string" || !path.isAbsolute(value)) continue;
    const normalized = path.resolve(value);
    if (
      normalized === path.parse(normalized).root ||
      normalized === userHome ||
      normalized === inferredUserHome ||
      isWithin(protectedHome, normalized) ||
      roots.includes(normalized)
    ) {
      continue;
    }
    roots.push(normalized);
  }
  return roots.slice(0, 64);
}

function safeVaultPath(value, userHome = null) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new TypeError("an absolute Obsidian vault path is required");
  }
  let resolved = path.resolve(value);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {}
  let resolvedUserHome = userHome && path.isAbsolute(userHome) ? path.resolve(userHome) : null;
  try {
    if (resolvedUserHome) resolvedUserHome = fs.realpathSync.native(resolvedUserHome);
  } catch {}
  if (
    resolved === path.parse(resolved).root ||
    resolved === resolvedUserHome ||
    (resolvedUserHome && isWithin(resolved, resolvedUserHome))
  ) {
    throw new TypeError("the Obsidian vault cannot contain a filesystem or user-home root");
  }
  if (resolvedUserHome) {
    const relative = path.relative(resolvedUserHome, resolved);
    const broadHomeRoots = new Set([
      ".codex",
      ".config",
      ".local",
      ".ssh",
      "AppData",
      "Applications",
      "Desktop",
      "Documents",
      "Downloads",
      "Library",
      "Movies",
      "Music",
      "Pictures",
      "Public",
    ]);
    if (relative && !relative.includes(path.sep) && broadHomeRoots.has(relative)) {
      throw new TypeError("the Obsidian vault must be a dedicated folder, not a broad home folder");
    }
  }
  return resolved;
}

function pathsOverlap(left, right) {
  const canonical = (value) => {
    let resolved = path.resolve(value);
    try {
      resolved = fs.realpathSync.native(resolved);
    } catch {}
    return resolved;
  };
  const resolvedLeft = canonical(left);
  const resolvedRight = canonical(right);
  return isWithin(resolvedLeft, resolvedRight) || isWithin(resolvedRight, resolvedLeft);
}

function assertRuntimePathsSeparated({ vaultPath, cacheDir, codexHome, userHome }) {
  const protectedPaths = [
    { label: "App userData", value: path.dirname(cacheDir) },
    { label: "Codex home", value: codexHome },
    { label: "SSH directory", value: userHome && path.join(userHome, ".ssh") },
  ];
  for (const item of protectedPaths) {
    if (item.value && pathsOverlap(vaultPath, path.resolve(item.value))) {
      throw new TypeError(`the Obsidian vault must not overlap ${item.label}`);
    }
  }
}

function permissionProfileConfig({ codexHome, userHome, vaultPath, skillPath, pythonReadRoots }) {
  const protectedHome = resolveCodexHome({ CODEX_HOME: codexHome });
  const protectedVault = safeVaultPath(vaultPath, userHome);
  const skillDir = path.dirname(exactSkillPath(skillPath));
  if (isWithin(protectedHome, skillDir)) {
    throw new TypeError("the bundled skill must live outside Codex home");
  }
  const runtimeRoots = safeReadRoots(pythonReadRoots, protectedHome, userHome);
  if (!runtimeRoots.length) {
    throw new TypeError("absolute Python runtime read roots are required");
  }
  const rules = [
    [":root", "deny"],
    [":minimal", "read"],
    [":tmpdir", "deny"],
    [":slash_tmp", "deny"],
    [protectedHome, "deny"],
    ...(userHome ? [[path.join(userHome, ".ssh"), "deny"]] : []),
    // Notes and attachments belong in the vault, but Obsidian configuration
    // and community-plugin code must never be modified by an unattended job.
    [path.join(protectedVault, ".obsidian"), "deny"],
    [skillDir, "read"],
    ...runtimeRoots.map((root) => [root, "read"]),
  ];
  return (
    'permissions.paperreader={extends=":workspace",filesystem={' +
    rules.map(([target, access]) => `${tomlString(target)}=${tomlString(access)}`).join(",") +
    "},network={enabled=true}}"
  );
}

function safePythonExecutable(value, runtimeRoots) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new TypeError("an absolute probed Python executable is required");
  }
  const executable = path.resolve(value);
  if (!runtimeRoots.some((root) => isWithin(root, executable))) {
    throw new TypeError("the Python executable must be inside a probed read root");
  }
  return executable;
}

function buildArgv({
  vaultPath,
  cacheDir,
  url,
  query,
  skillPath,
  model,
  reasoningEffort,
  codexHome,
  userHome,
  pythonPath,
  pythonReadRoots,
}) {
  const ownedCacheDir = normalizeAppCacheDir(cacheDir);
  if (!ownedCacheDir) throw new TypeError("a valid app-owned paper-cache directory is required");
  const protectedCodexHome = resolveCodexHome(
    codexHome ? { CODEX_HOME: codexHome } : process.env
  );
  const protectedUserHome = userHome
    ? resolveUserHome({ HOME: userHome })
    : resolveUserHome(process.env);
  const protectedVault = safeVaultPath(vaultPath, protectedUserHome);
  assertRuntimePathsSeparated({
    vaultPath: protectedVault,
    cacheDir: ownedCacheDir,
    codexHome: protectedCodexHome,
    userHome: protectedUserHome,
  });
  const protectedPythonRoots = safeReadRoots(
    pythonReadRoots,
    protectedCodexHome,
    protectedUserHome
  );
  const protectedPython = safePythonExecutable(pythonPath, protectedPythonRoots);
  const argv = [
    "--search",
    "--ask-for-approval",
    "never",
    "exec",
    "--json",
    "--ephemeral",
    "--strict-config",
    // Keep the user's Codex authentication, but do not load arbitrary user
    // MCP/plugin/hook configuration or exec-policy rules into an unattended
    // PaperReader job.
    "--ignore-user-config",
    "--ignore-rules",
    "--config",
    `projects.${tomlString(protectedVault)}.trust_level="untrusted"`,
    // The CLI otherwise discovers global and vault-local AGENTS.md files even
    // when config.toml is ignored. The bundled skill is the only instruction
    // file this unattended job should receive.
    "--config",
    "project_doc_max_bytes=0",
    "--config",
    "project_doc_fallback_filenames=[]",
    "--disable",
    "plugins",
    "--disable",
    "apps",
    "--disable",
    "hooks",
    "--disable",
    "skill_search",
    "--disable",
    "shell_snapshot",
    "--skip-git-repo-check",
    "--config",
    'default_permissions="paperreader"',
    "--config",
    permissionProfileConfig({
      codexHome: protectedCodexHome,
      userHome: protectedUserHome,
      vaultPath: protectedVault,
      skillPath,
      pythonReadRoots: protectedPythonRoots,
    }),
    "--config",
    'shell_environment_policy.inherit="core"',
    "--config",
    "shell_environment_policy.ignore_default_excludes=false",
    "--config",
    "allow_login_shell=false",
    "--config",
    `shell_environment_policy.set.PAPERREADER_CACHE_DIR=${tomlString(ownedCacheDir)}`,
    "--config",
    `shell_environment_policy.set.PAPERREADER_PYTHON=${tomlString(protectedPython)}`,
    "--config",
    `shell_environment_policy.set.TMPDIR=${tomlString(ownedCacheDir)}`,
    "--config",
    `shell_environment_policy.set.TMP=${tomlString(ownedCacheDir)}`,
    "--config",
    `shell_environment_policy.set.TEMP=${tomlString(ownedCacheDir)}`,
    "--config",
    'shell_environment_policy.set.PYTHONDONTWRITEBYTECODE="1"',
    "--add-dir",
    ownedCacheDir,
    "--color",
    "never",
    "-C",
    protectedVault,
  ];
  if (model) argv.push("--model", model);
  if (reasoningEffort) {
    argv.push("--config", `model_reasoning_effort=${tomlString(reasoningEffort)}`);
  }
  argv.push(buildPrompt({ url, query, skillPath }));
  return argv;
}

function spawnEnvironment(codexPath, cacheDir, baseEnv = process.env) {
  const ownedCacheDir = normalizeAppCacheDir(cacheDir);
  if (!ownedCacheDir) throw new TypeError("a valid app-owned paper-cache directory is required");
  const env = { ...baseEnv, PAPERREADER_CACHE_DIR: ownedCacheDir };
  // Authentication must come from `codex login`, not ambient secrets that the
  // model's shell subprocesses could inherit. CODEX_HOME is intentionally kept
  // so the CLI can find the credentials managed by `codex login`.
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.CODEX_ACCESS_TOKEN;
  if (process.platform !== "win32") env.PATH = enrichedPath(codexPath, env.PATH);
  return env;
}

function spawnOptions(vaultPath, env) {
  return {
    cwd: vaultPath,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env,
  };
}

function spawnRead({
  codexPath,
  vaultPath,
  cacheDir,
  skillPath,
  url,
  query,
  model,
  reasoningEffort,
  pythonPath,
  pythonReadRoots,
}) {
  const codexHome = resolveCodexHome(process.env);
  const userHome = resolveUserHome(process.env);
  const argv = buildArgv({
    vaultPath,
    cacheDir,
    skillPath,
    url,
    query,
    model,
    reasoningEffort,
    codexHome,
    userHome,
    pythonPath,
    pythonReadRoots,
  });
  const env = spawnEnvironment(codexPath, cacheDir);
  const child = spawn(codexPath, argv, spawnOptions(vaultPath, env));
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

module.exports = {
  resolveCodexPath,
  buildPrompt,
  buildArgv,
  resolveUserHome,
  resolveCodexHome,
  safeReadRoots,
  safePythonExecutable,
  safeVaultPath,
  pathsOverlap,
  assertRuntimePathsSeparated,
  permissionProfileConfig,
  spawnEnvironment,
  spawnOptions,
  spawnRead,
};
