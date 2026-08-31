const { spawn, execSync, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { enrichedPath } = require("./spawn-claude");
const { findPaperReadingSkill } = require("./skill-locator");
const { normalizeAppCacheDir } = require("./cache-clean");

function existing(p) {
  try {
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function resolveTraePath(override) {
  const ov = existing(override);
  if (ov) return ov;

  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (process.platform === "win32") {
    const candidates = [
      home && path.join(home, ".local", "bin", "trae-cli.exe"),
      home && path.join(home, ".local", "bin", "trae-agent.exe"),
    ];
    for (const name of ["trae-cli", "trae-agent"]) {
      try {
        const lines = execSync(`where.exe ${name}`, {
          encoding: "utf8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "ignore"],
        })
          .trim()
          .split(/\r?\n/);
        for (const line of lines) {
          if (/\.exe$/i.test(line) && existing(line)) return line;
        }
      } catch {}
    }
    for (const candidate of candidates) if (existing(candidate)) return candidate;
    return null;
  }

  try {
    const shell = process.env.SHELL || "/bin/sh";
    const found = execFileSync(
      shell,
      ["-lic", "command -v trae-cli || command -v trae-agent"],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (existing(found)) return found;
  } catch {}
  for (const dir of [
    home && path.join(home, ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ]) {
    if (!dir) continue;
    for (const name of ["trae-cli", "trae-agent"]) {
      const candidate = path.join(dir, name);
      if (existing(candidate)) return candidate;
    }
  }
  return null;
}

// Parse `trae-cli models --json` output into a compact list the settings UI can
// render. Each entry surfaces the current server load and whether the model
// supports the "max" context backend, so the user can dodge an overloaded model
// (the gpt-5.6-* family runs >100% load and stalls reads). Tolerant of shape
// drift: unknown/missing fields degrade gracefully instead of throwing.
function parseModels(jsonText) {
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw && raw.models) ? raw.models : [];
  const out = [];
  for (const m of arr) {
    if (!m || typeof m.name !== "string") continue;
    const meta = (m._meta && m._meta.trae) || {};
    const load = meta.load && typeof meta.load.percent === "number" ? meta.load.percent : null;
    const quota = meta.weeklyQuota || {};
    out.push({
      name: m.name,
      load,
      supportsMaxMode: !!meta.supportsMaxMode,
      contextWindow: m.context_window || meta.contextWindow || null,
      quotaApplies: !!quota.applies,
      quotaDepleted: !!(quota.applies && quota.isDepleted),
    });
  }
  return out;
}

// List the models the local Trae CLI can currently reach. Returns
// {ok:true, models:[...]} or {ok:false, reason}. Synchronous + time-boxed so a
// hung CLI can't wedge the settings window.
function listModels({ traePath } = {}) {
  const bin = resolveTraePath(traePath);
  if (!bin) return { ok: false, reason: "未找到 Trae CLI", models: [] };
  try {
    const env = { ...process.env };
    if (process.platform !== "win32") env.PATH = enrichedPath(bin, env.PATH);
    const out = execFileSync(bin, ["models", "--json"], {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      env,
    });
    return { ok: true, models: parseModels(out) };
  } catch (e) {
    return { ok: false, reason: e.message || String(e), models: [] };
  }
}

function buildPrompt(arg) {
  const { url, query, skillPath } = typeof arg === "string" ? { url: arg } : arg || {};
  const skill = skillPath || "the paper-reading SKILL.md in this vault";
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

function normalizePermissionMode(mode) {
  if (mode === "default" || mode === "auto") return mode;
  if (!mode || mode === "bypassPermissions" || mode === "bypass_permissions") {
    return "bypass_permissions";
  }
  return "default";
}

function buildArgv({
  vaultPath,
  url,
  query,
  skillPath,
  model,
  backendVariant,
  reasoningEffort,
  permissionMode,
}) {
  model = model == null ? "gpt-5.4" : model;
  backendVariant = backendVariant == null ? "max" : backendVariant;
  reasoningEffort = reasoningEffort == null ? "ultra" : reasoningEffort;
  const resolvedSkill = skillPath || findPaperReadingSkill(vaultPath, "trae");
  const argv = [
    "--search",
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--permission-mode",
    normalizePermissionMode(permissionMode),
    "--color",
    "never",
    "-C",
    vaultPath,
  ];
  if (model) argv.push("-m", model);
  argv.push("-c", 'model_provider="trae"');
  if (backendVariant) argv.push("-c", `model_backend_variant=${tomlString(backendVariant)}`);
  if (reasoningEffort) argv.push("-c", `model_reasoning_effort=${tomlString(reasoningEffort)}`);
  argv.push(buildPrompt({ url, query, skillPath: resolvedSkill }));
  return argv;
}

// Build the spawn() options. stdio[0] MUST be "ignore": Trae's `exec` treats a
// piped stdin as a `<stdin>` block appended to the prompt and then blocks
// forever waiting for its EOF. Node's default leaves stdin an open pipe we
// never write to or close, so the CLI hangs with zero output until the queue
// watchdog kills it (the "帮我读 十几分钟没反应" bug). Closing stdin fixes it.
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

function spawnEnvironment(traePath, cacheDir, pythonPath, baseEnv = process.env) {
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
  if (process.platform !== "win32") env.PATH = enrichedPath(traePath, env.PATH);
  return env;
}

function spawnRead({
  traePath,
  vaultPath,
  cacheDir,
  skillPath,
  url,
  query,
  model,
  backendVariant,
  reasoningEffort,
  permissionMode,
  pythonPath,
}) {
  const argv = buildArgv({
    vaultPath,
    url,
    query,
    skillPath,
    model,
    backendVariant,
    reasoningEffort,
    permissionMode,
  });
  const env = spawnEnvironment(traePath, cacheDir, pythonPath);
  const child = spawn(traePath, argv, spawnOptions(vaultPath, env));
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

module.exports = {
  resolveTraePath,
  buildPrompt,
  buildArgv,
  spawnRead,
  spawnOptions,
  spawnEnvironment,
  parseModels,
  listModels,
};
