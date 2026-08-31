// Detect the runtime prerequisites: the Obsidian notes vault, the bundled
// paper-reading skill, and the selected local AI CLI. Used on first run and in
// settings.

const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const {
  resolveCodexPath,
  resolveUserHome,
  resolveCodexHome,
  safeVaultPath,
  pathsOverlap,
  assertRuntimePathsSeparated,
} = require("./spawn-codex");
const { resolveClaudePath, enrichedPath } = require("./spawn-claude");
const { resolveTraePath } = require("./spawn-trae");
const {
  hasPaperReadingSkill,
  findBundledPaperReadingSkill,
} = require("./skill-locator");

function isVault(p) {
  try {
    return !!p && fs.existsSync(path.join(p, ".obsidian"));
  } catch {
    return false;
  }
}
function hasSkill(p, provider = "codex") {
  return hasPaperReadingSkill(p, provider);
}

function obsidianConfigFiles(home, platform = process.platform, env = process.env) {
  if (!home) return [];
  if (platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "obsidian", "obsidian.json")];
  }
  if (platform === "win32") {
    return [
      env.APPDATA && path.join(env.APPDATA, "obsidian", "obsidian.json"),
      path.join(home, "AppData", "Roaming", "obsidian", "obsidian.json"),
    ].filter(Boolean);
  }
  return [path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "obsidian", "obsidian.json")];
}

function configuredObsidianVaults(home, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const files = obsidianConfigFiles(home, options.platform, options.env);
  const vaults = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fsImpl.readFileSync(file, "utf8"));
      for (const entry of Object.values((data && data.vaults) || {})) {
        if (entry && typeof entry.path === "string" && path.isAbsolute(entry.path)) {
          vaults.push(entry.path);
        }
      }
    } catch {}
  }
  return [...new Set(vaults)];
}

// Best-effort defaults for a fresh install: use Obsidian's own registered
// vaults first, then generic home-directory conventions. Never ship a
// developer-specific drive/path in production defaults.
function detectDefaults() {
  const out = { vaultPath: "", codexPath: "", claudePath: "", traePath: "" };
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    ...configuredObsidianVaults(home),
    home && path.join(home, "Obsidian", "PaperReadingDaily"),
    home && path.join(home, "Documents", "PaperReadingDaily"),
  ].filter(Boolean);
  const userHome = resolveUserHome(process.env);
  for (const v of candidates) {
    // The skill is bundled with the app, so a candidate only needs to be a real
    // Obsidian vault to be usable as the notes destination.
    if (!isVault(v)) continue;
    try {
      out.vaultPath = safeVaultPath(v, userHome);
      break;
    } catch {}
  }
  const codex = resolveCodexPath("");
  if (codex) out.codexPath = codex;
  const c = resolveClaudePath("");
  if (c) out.claudePath = c;
  const t = resolveTraePath("");
  if (t) out.traePath = t;
  return out;
}

function probeCli(name, binaryPath, versionArgs) {
  const cli = {
    path: binaryPath || "",
    ok: !!binaryPath,
    version: "",
    reason: binaryPath ? "" : `未找到 ${name}（请在设置中指定路径）`,
  };
  if (!binaryPath) return cli;
  try {
    cli.version = execFileSync(binaryPath, versionArgs, {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    }).trim();
  } catch (e) {
    cli.ok = false;
    cli.reason = `${name} 无法执行：${e.message}`;
  }
  return cli;
}

function codexConfigProbeArgs(schemaPath) {
  if (typeof schemaPath !== "string" || !path.isAbsolute(schemaPath)) {
    throw new TypeError("an absolute missing schema path is required");
  }
  const probeRoot = path.join(os.tmpdir(), "paperreader-codex-config-probe");
  const probeVault = path.join(probeRoot, "vault");
  const probeCache = path.join(probeRoot, "cache");
  const probeSkill = path.join(probeRoot, "skill");
  const probePython = path.join(probeRoot, "python");
  const probeCodexHome = path.join(probeRoot, ".codex");
  const probeSsh = path.join(probeRoot, ".ssh");
  const profile =
    'permissions.paperreader_probe={extends=":workspace",filesystem={' +
    [
      [":root", "deny"],
      [":minimal", "read"],
      [":tmpdir", "deny"],
      [":slash_tmp", "deny"],
      [probeCodexHome, "deny"],
      [probeSsh, "deny"],
      [path.join(probeVault, ".obsidian"), "deny"],
      [probeSkill, "read"],
      [probePython, "read"],
    ]
      .map(([target, access]) => `${JSON.stringify(target)}=${JSON.stringify(access)}`)
      .join(",") +
    "},network={enabled=true}}";
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--strict-config",
    "--ignore-user-config",
    "--ignore-rules",
    "--config",
    `projects.${JSON.stringify(probeVault)}.trust_level="untrusted"`,
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
    'default_permissions="paperreader_probe"',
    "--config",
    profile,
    "--config",
    'shell_environment_policy.inherit="core"',
    "--config",
    "shell_environment_policy.ignore_default_excludes=false",
    "--config",
    "allow_login_shell=false",
    "--config",
    `shell_environment_policy.set.PAPERREADER_CACHE_DIR=${JSON.stringify(probeCache)}`,
    "--config",
    `shell_environment_policy.set.PAPERREADER_PYTHON=${JSON.stringify(path.join(probePython, "python3"))}`,
    "--config",
    `shell_environment_policy.set.TMPDIR=${JSON.stringify(probeCache)}`,
    "--config",
    `shell_environment_policy.set.TMP=${JSON.stringify(probeCache)}`,
    "--config",
    `shell_environment_policy.set.TEMP=${JSON.stringify(probeCache)}`,
    "--config",
    'shell_environment_policy.set.PYTHONDONTWRITEBYTECODE="1"',
    "--output-schema",
    schemaPath,
    "paperreader local configuration probe",
  ];
}

function probeCodex(binaryPath, run = execFileSync) {
  const cli = {
    path: binaryPath || "",
    ok: !!binaryPath,
    version: "",
    reason: binaryPath ? "" : "未找到 Codex CLI（请在设置中指定路径）",
  };
  if (!binaryPath) return cli;
  const options = {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  };
  try {
    cli.version = String(run(binaryPath, ["--version"], options) || "").trim();
  } catch (error) {
    cli.ok = false;
    cli.reason = `Codex CLI 无法执行：${error.message}`;
    return cli;
  }
  try {
    const rootHelp = String(run(binaryPath, ["--help"], options) || "");
    if (!["--search", "--ask-for-approval"].every((flag) => rootHelp.includes(flag))) {
      cli.ok = false;
      cli.reason = "Codex CLI 版本过旧；请按官方说明升级后重试";
      return cli;
    }
    const help = String(run(binaryPath, ["exec", "--help"], options) || "");
    const required = [
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--strict-config",
      "--disable",
      "--skip-git-repo-check",
      "--add-dir",
      "--color",
      "--cd",
    ];
    if (!required.every((flag) => help.includes(flag))) {
      cli.ok = false;
      cli.reason = "Codex CLI 版本过旧；请按官方说明升级后重试";
      return cli;
    }
  } catch {
    cli.ok = false;
    cli.reason = "无法确认 Codex CLI 的安全非交互能力；请升级后重试";
    return cli;
  }
  // `codex exec --help` accepts unknown config keys without resolving them.
  // Force a real, local config parse with a deliberately missing output-schema
  // file. A compatible CLI must reject that exact missing file *after* it has
  // accepted every security-sensitive config override. This never reaches a
  // model request and does not create or modify a file.
  const missingSchema = path.join(
    os.tmpdir(),
    `.paperreader-codex-probe-${process.pid}-${crypto.randomBytes(12).toString("hex")}.schema.json`
  );
  try {
    run(binaryPath, codexConfigProbeArgs(missingSchema), options);
    cli.ok = false;
    cli.reason = "无法确认 Codex CLI 的隔离配置能力；请升级后重试";
    return cli;
  } catch (error) {
    const stderr = String((error && error.stderr) || "");
    if (!stderr.includes(missingSchema)) {
      cli.ok = false;
      cli.reason = "无法确认 Codex CLI 的隔离配置能力；请升级后重试";
      return cli;
    }
  }
  try {
    const sandboxHelp = String(run(binaryPath, ["sandbox", "--help"], options) || "");
    if (!["--permission-profile", "--config", "--cd"].every((flag) => sandboxHelp.includes(flag))) {
      cli.ok = false;
      cli.reason = "Codex CLI 版本过旧，不支持精读任务所需的权限配置；请升级后重试";
      return cli;
    }
  } catch {
    cli.ok = false;
    cli.reason = "无法确认 Codex CLI 的权限配置能力；请升级后重试";
    return cli;
  }
  try {
    run(binaryPath, ["login", "status"], options);
  } catch {
    cli.ok = false;
    cli.reason = "Codex CLI 尚未登录；请在终端运行 codex 并完成登录";
  }
  return cli;
}

const FITZ_ERROR_PREFIX = "__PAPERREADER_FITZ_ERROR__:";
const PYTHON_ROOTS_PREFIX = "__PAPERREADER_PYTHON_ROOTS__:";

function normalizePythonReadRoots(values) {
  const roots = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string" || !path.isAbsolute(value)) continue;
    const normalized = path.resolve(value);
    if (normalized === path.parse(normalized).root || roots.includes(normalized)) continue;
    roots.push(normalized);
  }
  return roots.slice(0, 64);
}

// The paper-reading scripts invoke `python3` and import PyMuPDF as `fitz`.
// Probe that exact runtime once (in background-task's worker), without ever
// installing or mutating the user's Python environment.
function probePython(options = {}) {
  const command = options.command || "python3";
  const run = options.execFileSync || execFileSync;
  const env = { ...(options.env || process.env) };
  if (process.platform !== "win32") env.PATH = enrichedPath("", env.PATH);
  const script = [
    "import json, os, site, sys, sysconfig",
    "print(sys.executable)",
    "try:",
    "    import fitz",
    "except Exception as error:",
    `    print("${FITZ_ERROR_PREFIX}" + type(error).__name__ + ": " + str(error))`,
    "    raise SystemExit(42)",
    "print(getattr(fitz, 'VersionBind', getattr(fitz, '__version__', 'unknown')))",
    "roots = [sys.executable, os.path.dirname(sys.executable), sys.prefix, sys.base_prefix, os.path.dirname(fitz.__file__)]",
    "roots.extend(v for v in sysconfig.get_paths().values() if v)",
    "try:",
    "    roots.extend(site.getsitepackages())",
    "except Exception:",
    "    pass",
    "try:",
    "    roots.append(site.getusersitepackages())",
    "except Exception:",
    "    pass",
    `print("${PYTHON_ROOTS_PREFIX}" + json.dumps(sorted(set(os.path.abspath(v) for v in roots if v))))`,
  ].join("\n");
  const result = {
    command,
    path: "",
    ok: false,
    fitzOk: false,
    version: "",
    readRoots: [],
    reason: "",
  };
  try {
    const output = run(command, ["-c", script], {
      encoding: "utf8",
      timeout: 12_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    const lines = String(output || "").trim().split(/\r?\n/).filter(Boolean);
    result.path = lines[0] || command;
    result.version = lines[1] || "";
    const rootsLine = lines.find((line) => line.startsWith(PYTHON_ROOTS_PREFIX));
    try {
      result.readRoots = normalizePythonReadRoots(
        JSON.parse(rootsLine ? rootsLine.slice(PYTHON_ROOTS_PREFIX.length) : "[]")
      );
    } catch {
      result.readRoots = [];
    }
    if (!result.readRoots.length) {
      result.reason = "无法确定 Python / PyMuPDF 的只读运行目录；请重新检测环境";
      return result;
    }
    result.ok = true;
    result.fitzOk = true;
    return result;
  } catch (error) {
    const stdout = String((error && error.stdout) || "");
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const fitzError = lines.find((line) => line.startsWith(FITZ_ERROR_PREFIX));
    result.path = (fitzError ? lines.find((line) => line !== fitzError) : "") || "";
    if (fitzError) {
      const python = result.path || command;
      const shownCommand = /\s/.test(python) ? `"${python}"` : python;
      result.reason =
        `已找到 ${python}，但无法导入 PyMuPDF（fitz）。` +
        `请为这个解释器手动安装依赖（例如：${shownCommand} -m pip install "PyMuPDF>=1.24,<2"）`;
    } else if (error && error.code === "ENOENT") {
      result.reason = "未找到 python3；请先安装 Python 3，并确保终端可运行 python3";
    } else {
      const detail = String((error && error.message) || error || "未知错误").split(/\r?\n/)[0];
      result.reason = `python3 / PyMuPDF 检测失败：${detail}`;
    }
    return result;
  }
}

function probeEnv(settings, options = {}) {
  const s = settings || {};
  const provider = ["codex", "claude", "trae"].includes(s.provider) ? s.provider : "codex";
  const vaultPath = s.vaultPath || "";
  const vault = { path: vaultPath, ok: false, reason: "" };
  const userHome = Object.prototype.hasOwnProperty.call(options, "userHome")
    ? options.userHome
    : resolveUserHome(process.env);
  // The skill ships with the app now (repo/packaged), so the vault only needs to
  // be a real Obsidian vault — notes are written into it, the skill is not.
  const skillPath = findBundledPaperReadingSkill();
  if (!vaultPath) vault.reason = "未设置 vault 路径";
  else if (!fs.existsSync(vaultPath)) vault.reason = "路径不存在";
  else if (!isVault(vaultPath)) vault.reason = "不是 Obsidian vault（缺 .obsidian/）";
  else {
    try {
      vault.path = safeVaultPath(vaultPath, userHome);
      if (
        typeof s.__paperCacheDir === "string" &&
        path.isAbsolute(s.__paperCacheDir) &&
        pathsOverlap(vault.path, path.dirname(path.resolve(s.__paperCacheDir)))
      ) {
        throw new TypeError("the Obsidian vault must not overlap App userData");
      }
      if (provider === "codex" && typeof s.__paperCacheDir === "string" && s.__paperCacheDir) {
        assertRuntimePathsSeparated({
          vaultPath: vault.path,
          cacheDir: path.resolve(s.__paperCacheDir),
          codexHome: resolveCodexHome(process.env),
          userHome,
        });
      }
      if (!skillPath) vault.reason = "未找到 paper-reading 技能（应随 app 内置）";
      else {
        vault.ok = true;
        vault.skillPath = skillPath;
      }
    } catch (error) {
      const message = String((error && error.message) || "");
      vault.reason = /overlap/.test(message)
        ? "Obsidian vault 不能与 PaperReader、Codex 或 SSH 配置目录重叠，请选择专用 vault 文件夹"
        : /broad home folder/.test(message)
          ? "Obsidian vault 不能直接使用 Library、Documents 等宽泛主目录，请选择其下的专用 vault 文件夹"
          : "Obsidian vault 不能是文件系统根目录、用户主目录或其上级目录，请选择专用 vault 文件夹";
    }
  }

  const inactive = (p) => ({ path: p || "", ok: false, version: "", reason: "未选择" });
  const codex =
    provider === "codex"
      ? (options.probeCodex || probeCodex)(resolveCodexPath(s.codexPath))
      : inactive(s.codexPath);
  const claude =
    provider === "claude"
      ? probeCli("claude", resolveClaudePath(s.claudePath), ["--version"])
      : inactive(s.claudePath);
  const trae =
    provider === "trae"
      ? probeCli("Trae CLI", resolveTraePath(s.traePath), ["--version"])
      : inactive(s.traePath);
  const cli = provider === "codex" ? codex : provider === "claude" ? claude : trae;
  const python = (options.probePython || probePython)();

  return {
    provider,
    vault,
    codex,
    claude,
    trae,
    cli,
    python,
    ready: vault.ok && cli.ok && python.ok,
  };
}

module.exports = {
  probeEnv,
  detectDefaults,
  isVault,
  hasSkill,
  obsidianConfigFiles,
  configuredObsidianVaults,
  probeCodex,
  codexConfigProbeArgs,
  probePython,
  normalizePythonReadRoots,
};
