const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  obsidianConfigFiles,
  configuredObsidianVaults,
  probeCodex,
  codexConfigProbeArgs,
  probePython,
  pythonCandidates,
  normalizePythonReadRoots,
  probeEnv,
} = require("../app/env-probe");

const TEST_PYTHON_ROOT = path.join(path.parse(process.cwd()).root, "paperreader-python-runtime");

test("probeCodex requires both an executable version and a saved CLI login", () => {
  const calls = [];
  const ok = probeCodex("/usr/local/bin/codex", (_binary, args) => {
    calls.push(args);
    if (args[0] === "--version") return "codex-cli 0.146.1\n";
    if (args[0] === "--help") return "--search --ask-for-approval\n";
    if (args[0] === "exec" && args.includes("--help")) {
      return "--json --ephemeral --ignore-user-config --ignore-rules --strict-config --disable --skip-git-repo-check --add-dir --color --cd\n";
    }
    if (args[0] === "sandbox") return "--permission-profile --config --cd\n";
    if (args[0] === "exec" && args.includes("--output-schema")) {
      const error = new Error("missing schema");
      error.stderr = `failed to read JSON schema file ${args[args.indexOf("--output-schema") + 1]}`;
      throw error;
    }
    return "Logged in using ChatGPT\n";
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.version, "codex-cli 0.146.1");
  assert.deepStrictEqual(calls.slice(0, 3), [
    ["--version"],
    ["--help"],
    ["exec", "--help"],
  ]);
  assert.deepStrictEqual(calls[3].slice(-3), [
    "--output-schema",
    calls[3].at(-2),
    "paperreader local configuration probe",
  ]);
  assert.ok(path.isAbsolute(calls[3].at(-2)));
  assert.deepStrictEqual(calls.slice(4), [["sandbox", "--help"], ["login", "status"]]);

  const loggedOut = probeCodex("/usr/local/bin/codex", (_binary, args) => {
    if (args[0] === "--version") return "codex-cli 0.146.1";
    if (args[0] === "--help") return "--search --ask-for-approval";
    if (args[0] === "exec" && args.includes("--help")) {
      return "--json --ephemeral --ignore-user-config --ignore-rules --strict-config --disable --skip-git-repo-check --add-dir --color --cd";
    }
    if (args[0] === "sandbox") return "--permission-profile --config --cd";
    if (args[0] === "exec" && args.includes("--output-schema")) {
      const error = new Error("missing schema");
      error.stderr = args[args.indexOf("--output-schema") + 1];
      throw error;
    }
    throw new Error("not logged in");
  });
  assert.strictEqual(loggedOut.ok, false);
  assert.match(loggedOut.reason, /尚未登录/);

  const tooOld = probeCodex("/usr/local/bin/codex", (_binary, args) =>
    args[0] === "--version" ? "codex-cli 0.1.0" : "legacy help"
  );
  assert.strictEqual(tooOld.ok, false);
  assert.match(tooOld.reason, /版本过旧/);

  const noPermissionProfiles = probeCodex("/usr/local/bin/codex", (_binary, args) => {
    if (args[0] === "--version") return "codex-cli 0.138.0";
    if (args[0] === "--help") return "--search --ask-for-approval";
    if (args[0] === "exec" && args.includes("--help")) {
      return "--json --ephemeral --ignore-user-config --ignore-rules --strict-config --disable --skip-git-repo-check --add-dir --color --cd";
    }
    if (args[0] === "exec" && args.includes("--output-schema")) {
      const error = new Error("missing schema");
      error.stderr = args[args.indexOf("--output-schema") + 1];
      throw error;
    }
    if (args[0] === "sandbox") return "legacy sandbox help";
    return "Logged in using ChatGPT";
  });
  assert.strictEqual(noPermissionProfiles.ok, false);
  assert.match(noPermissionProfiles.reason, /权限配置/);

  const invalidConfig = probeCodex("/usr/local/bin/codex", (_binary, args) => {
    if (args[0] === "--version") return "codex-cli 0.146.1";
    if (args[0] === "--help") return "--search --ask-for-approval";
    if (args[0] === "exec" && args.includes("--help")) {
      return "--json --ephemeral --ignore-user-config --ignore-rules --strict-config --disable --skip-git-repo-check --add-dir --color --cd";
    }
    if (args[0] === "sandbox") return "--permission-profile --config --cd";
    if (args[0] === "exec" && args.includes("--output-schema")) {
      const error = new Error("unknown configuration field");
      error.stderr = "unknown configuration field project_doc_max_bytes";
      throw error;
    }
    return "Logged in using ChatGPT";
  });
  assert.strictEqual(invalidConfig.ok, false);
  assert.match(invalidConfig.reason, /隔离配置能力/);
});

test("Codex config probe resolves every security-sensitive override before model execution", () => {
  const schema = path.join(os.tmpdir(), "paperreader-never-created.schema.json");
  const args = codexConfigProbeArgs(schema);
  assert.strictEqual(args[0], "exec");
  assert.ok(args.includes("--strict-config"));
  assert.ok(args.includes("project_doc_max_bytes=0"));
  assert.ok(args.includes("project_doc_fallback_filenames=[]"));
  assert.ok(args.some((value) => value.includes('":root"="deny"')));
  assert.ok(args.some((value) => value.includes(".obsidian")));
  assert.deepStrictEqual(args.slice(-3), ["--output-schema", schema, "paperreader local configuration probe"]);
});

test("obsidianConfigFiles uses platform-generic application data locations", () => {
  assert.deepStrictEqual(obsidianConfigFiles("/Users/alice", "darwin", {}), [
    path.join("/Users/alice", "Library", "Application Support", "obsidian", "obsidian.json"),
  ]);
  assert.deepStrictEqual(
    obsidianConfigFiles("C:\\Users\\alice", "win32", { APPDATA: "C:\\Users\\alice\\AppData\\Roaming" }),
    [
      path.join("C:\\Users\\alice\\AppData\\Roaming", "obsidian", "obsidian.json"),
      path.join("C:\\Users\\alice", "AppData", "Roaming", "obsidian", "obsidian.json"),
    ]
  );
});

test("configuredObsidianVaults reads absolute registered vaults and deduplicates", () => {
  const config = JSON.stringify({
    vaults: {
      a: { path: "/Users/alice/Documents/Papers" },
      b: { path: "/Users/alice/Documents/Papers" },
      c: { path: "relative/not-safe" },
    },
  });
  const fsImpl = { readFileSync: () => config };
  assert.deepStrictEqual(
    configuredObsidianVaults("/Users/alice", { fsImpl, platform: "darwin", env: {} }),
    ["/Users/alice/Documents/Papers"]
  );
});

test("configuredObsidianVaults fails soft for a missing or malformed Obsidian config", () => {
  const fsImpl = { readFileSync: () => { throw new Error("missing"); } };
  assert.deepStrictEqual(
    configuredObsidianVaults("/Users/alice", { fsImpl, platform: "darwin", env: {} }),
    []
  );
});

test("probePython runs python3 and verifies the fitz import without installing anything", () => {
  let invocation = null;
  const result = probePython({
    platform: "darwin",
    env: { PATH: "/test/bin" },
    execFileSync(command, args, options) {
      invocation = { command, args, options };
      return (
        "/usr/local/bin/python3\n1.26.5\n" +
        `__PAPERREADER_PYTHON_ROOTS__:${JSON.stringify([TEST_PYTHON_ROOT])}\n`
      );
    },
  });

  assert.strictEqual(invocation.command, "python3");
  assert.deepStrictEqual(invocation.args.slice(0, 1), ["-c"]);
  assert.match(invocation.args[1], /import fitz/);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.fitzOk, true);
  assert.strictEqual(result.path, "/usr/local/bin/python3");
  assert.strictEqual(result.version, "1.26.5");
  assert.deepStrictEqual(result.readRoots, [TEST_PYTHON_ROOT]);
});

test("pythonCandidates prefers the launcher then python.exe on Windows and honours overrides", () => {
  assert.deepStrictEqual(pythonCandidates("darwin"), [{ command: "python3", prefixArgs: [] }]);
  assert.deepStrictEqual(pythonCandidates("win32"), [
    { command: "py", prefixArgs: ["-3"] },
    { command: "python", prefixArgs: [] },
    { command: "python3", prefixArgs: [] },
  ]);
  assert.deepStrictEqual(pythonCandidates("win32", "C:\\tools\\python\\python.exe"), [
    { command: "C:\\tools\\python\\python.exe", prefixArgs: [] },
  ]);
});

test("probePython falls through failed Windows candidates to a working interpreter", () => {
  const invocations = [];
  const result = probePython({
    platform: "win32",
    execFileSync(command, args) {
      invocations.push({ command, args: args.slice(0, args.length - 1) });
      if (command === "py") {
        const error = new Error("spawn py ENOENT");
        error.code = "ENOENT";
        throw error;
      }
      return (
        "C:\\Python312\\python.exe\n1.26.5\n" +
        `__PAPERREADER_PYTHON_ROOTS__:${JSON.stringify([TEST_PYTHON_ROOT])}\n`
      );
    },
  });

  assert.deepStrictEqual(invocations.map((entry) => entry.command), ["py", "python"]);
  assert.deepStrictEqual(invocations[0].args, ["-3", "-c"]);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.command, "python");
  assert.strictEqual(result.path, "C:\\Python312\\python.exe");
});

test("normalizePythonReadRoots accepts bounded absolute non-root paths only", () => {
  assert.deepStrictEqual(
    normalizePythonReadRoots([TEST_PYTHON_ROOT, TEST_PYTHON_ROOT, "relative", path.parse(TEST_PYTHON_ROOT).root]),
    [TEST_PYTHON_ROOT]
  );
});

test("probePython distinguishes a missing python3 from a missing fitz module", () => {
  const missingPython = probePython({
    platform: "darwin",
    execFileSync() {
      const error = new Error("spawn python3 ENOENT");
      error.code = "ENOENT";
      throw error;
    },
  });
  assert.strictEqual(missingPython.ok, false);
  assert.match(missingPython.reason, /未找到 python3/);

  const missingOnWindows = probePython({
    platform: "win32",
    execFileSync() {
      const error = new Error("spawn ENOENT");
      error.code = "ENOENT";
      throw error;
    },
  });
  assert.strictEqual(missingOnWindows.ok, false);
  assert.match(missingOnWindows.reason, /Python 3/);
  assert.match(missingOnWindows.reason, /py launcher|python\.exe/);

  const missingFitz = probePython({
    platform: "darwin",
    execFileSync() {
      const error = new Error("python exited 42");
      error.stdout =
        "/usr/bin/python3\n__PAPERREADER_FITZ_ERROR__:ModuleNotFoundError: No module named fitz\n";
      throw error;
    },
  });
  assert.strictEqual(missingFitz.path, "/usr/bin/python3");
  assert.strictEqual(missingFitz.ok, false);
  assert.strictEqual(missingFitz.fitzOk, false);
  assert.match(missingFitz.reason, /PyMuPDF（fitz）/);
  assert.match(missingFitz.reason, /手动安装/);

  // A found-but-unusable interpreter must win over "not found" when a later
  // Windows candidate is absent entirely.
  const fitzBeatsNotFound = probePython({
    platform: "win32",
    execFileSync(command) {
      if (command === "py") {
        const error = new Error("python exited 42");
        error.stdout =
          "C:\\Python312\\python.exe\n__PAPERREADER_FITZ_ERROR__:ModuleNotFoundError: No module named fitz\n";
        throw error;
      }
      const error = new Error("spawn ENOENT");
      error.code = "ENOENT";
      throw error;
    },
  });
  assert.strictEqual(fitzBeatsNotFound.ok, false);
  assert.match(fitzBeatsNotFound.reason, /PyMuPDF（fitz）/);
  assert.strictEqual(fitzBeatsNotFound.path, "C:\\Python312\\python.exe");
});

test("probeEnv gates readiness on python3 plus fitz", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-python-probe-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  fs.mkdirSync(path.join(vault, ".obsidian"));

  const result = probeEnv(
    { provider: "trae", vaultPath: vault, traePath: process.execPath },
    {
      probePython: () => ({
        command: "python3",
        path: "",
        ok: false,
        fitzOk: false,
        version: "",
        reason: "缺少 fitz",
      }),
    }
  );

  assert.strictEqual(result.vault.ok, true);
  assert.strictEqual(result.cli.ok, true);
  assert.strictEqual(result.python.reason, "缺少 fitz");
  assert.strictEqual(result.ready, false);
});

test("probeEnv rejects a user-home directory even when it contains .obsidian", (t) => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-home-vault-"));
  t.after(() => fs.rmSync(fakeHome, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fakeHome, ".obsidian"));

  const result = probeEnv(
    { provider: "trae", vaultPath: fakeHome, traePath: process.execPath },
    {
      userHome: fakeHome,
      probePython: () => ({ ok: true, fitzOk: true, path: process.execPath, readRoots: [] }),
    }
  );

  assert.strictEqual(result.vault.ok, false);
  assert.match(result.vault.reason, /用户主目录/);
  assert.strictEqual(result.ready, false);
});

test("probeEnv rejects broad and App-overlapping vaults before a Codex job starts", (t) => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-safe-vault-home-"));
  const broadVault = path.join(fakeHome, "Library");
  const userData = path.join(fakeHome, "PaperReaderData");
  const overlappingVault = path.join(userData, "Notes");
  t.after(() => fs.rmSync(fakeHome, { recursive: true, force: true }));
  fs.mkdirSync(path.join(broadVault, ".obsidian"), { recursive: true });
  fs.mkdirSync(path.join(overlappingVault, ".obsidian"), { recursive: true });

  const python = () => ({ ok: true, fitzOk: true, path: process.execPath, readRoots: [] });
  const broad = probeEnv(
    { provider: "trae", vaultPath: broadVault, traePath: process.execPath },
    { userHome: fakeHome, probePython: python }
  );
  assert.strictEqual(broad.vault.ok, false);
  assert.match(broad.vault.reason, /宽泛主目录/);

  const overlap = probeEnv(
    {
      provider: "trae",
      vaultPath: overlappingVault,
      traePath: process.execPath,
      __paperCacheDir: path.join(userData, "paper-cache"),
    },
    { userHome: fakeHome, probePython: python }
  );
  assert.strictEqual(overlap.vault.ok, false);
  assert.match(overlap.vault.reason, /配置目录重叠/);
});

test("settings status renders an actionable Python / PyMuPDF prerequisite line", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "settings.html"), "utf8");
  assert.match(html, /p\.python/);
  assert.match(html, /Python \/ PyMuPDF/);
  assert.match(html, /python\.reason/);
  assert.match(html, /OpenAI Codex CLI（默认）/);
  assert.match(html, /Claude Code/);
  assert.match(html, /TraeCode CLI（仅已获提供的用户）/);
  assert.match(html, /论文内容与提示发送给所选 CLI 服务/);
  assert.match(html, /不收集或保存 AI provider 凭据/);
  assert.match(html, /PaperReader 本身不做遥测/);
});
