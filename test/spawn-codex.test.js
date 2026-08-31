const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const {
  buildPrompt,
  buildArgv,
  resolveUserHome,
  resolveCodexHome,
  safeReadRoots,
  safePythonExecutable,
  safeVaultPath,
  assertRuntimePathsSeparated,
  permissionProfileConfig,
  spawnEnvironment,
  spawnOptions,
} = require("../app/spawn-codex");

const ROOT = path.parse(process.cwd()).root;
const VAULT = path.join(ROOT, "paper-reader-test-vault");
const CACHE = path.join(ROOT, "paper-reader-user-data", "paper-cache");
const CODEX_HOME = path.join(ROOT, "paper-reader-user-home", ".codex");
const USER_HOME = path.dirname(CODEX_HOME);
const SKILL = path.join(ROOT, "PaperReader Resources", "skills", "paper-reading", "SKILL.md");
const SKILL_DIR = path.dirname(SKILL);
const PYTHON_ROOT = path.join(ROOT, "paper-reader-python-runtime");
const PYTHON = path.join(PYTHON_ROOT, "bin", "python3");
const URL = "https://arxiv.org/abs/2608.01234";

test("Codex prompt names the exact bundled skill for URL and title reads", () => {
  const byUrl = buildPrompt({ url: URL, skillPath: SKILL });
  assert.ok(byUrl.includes(SKILL));
  assert.ok(byUrl.includes(URL));
  assert.match(byUrl, /do not ask questions/i);

  const byTitle = buildPrompt({ query: "A tactile robot paper", skillPath: SKILL });
  assert.ok(byTitle.includes(SKILL));
  assert.match(byTitle, /A tactile robot paper/);
  assert.match(byTitle, /stop instead of guessing/i);
});

test("Codex prompt rejects a missing or relative skill path", () => {
  assert.throws(() => buildPrompt({ url: URL }), /absolute bundled/);
  assert.throws(
    () => buildPrompt({ url: URL, skillPath: "skills/paper-reading/SKILL.md" }),
    /absolute bundled/
  );
});

test("buildArgv uses the verified headless least-privilege Codex invocation", () => {
  const argv = buildArgv({
    vaultPath: VAULT,
    cacheDir: CACHE,
    url: URL,
    skillPath: SKILL,
    model: "gpt-5.6-codex",
    reasoningEffort: "high",
    codexHome: CODEX_HOME,
    userHome: USER_HOME,
    pythonPath: PYTHON,
    pythonReadRoots: [PYTHON_ROOT],
  });
  const prompt = argv.at(-1);
  assert.ok(prompt.includes(SKILL));
  assert.deepStrictEqual(argv.slice(0, -1), [
    "--search",
    "--ask-for-approval",
    "never",
    "exec",
    "--json",
    "--ephemeral",
    "--strict-config",
    "--ignore-user-config",
    "--ignore-rules",
    "--config",
    `projects.${JSON.stringify(VAULT)}.trust_level="untrusted"`,
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
    `permissions.paperreader={extends=":workspace",filesystem={":root"="deny",":minimal"="read",":tmpdir"="deny",":slash_tmp"="deny",${JSON.stringify(CODEX_HOME)}="deny",${JSON.stringify(path.join(USER_HOME, ".ssh"))}="deny",${JSON.stringify(path.join(VAULT, ".obsidian"))}="deny",${JSON.stringify(SKILL_DIR)}="read",${JSON.stringify(PYTHON_ROOT)}="read"},network={enabled=true}}`,
    "--config",
    'shell_environment_policy.inherit="core"',
    "--config",
    "shell_environment_policy.ignore_default_excludes=false",
    "--config",
    "allow_login_shell=false",
    "--config",
    `shell_environment_policy.set.PAPERREADER_CACHE_DIR=${JSON.stringify(CACHE)}`,
    "--config",
    `shell_environment_policy.set.PAPERREADER_PYTHON=${JSON.stringify(PYTHON)}`,
    "--config",
    `shell_environment_policy.set.TMPDIR=${JSON.stringify(CACHE)}`,
    "--config",
    `shell_environment_policy.set.TMP=${JSON.stringify(CACHE)}`,
    "--config",
    `shell_environment_policy.set.TEMP=${JSON.stringify(CACHE)}`,
    "--config",
    'shell_environment_policy.set.PYTHONDONTWRITEBYTECODE="1"',
    "--add-dir",
    CACHE,
    "--color",
    "never",
    "-C",
    VAULT,
    "--model",
    "gpt-5.6-codex",
    "--config",
    'model_reasoning_effort="high"',
  ]);
  assert.doesNotMatch(argv.join(" "), /danger-full-access|dangerously-bypass/);
  assert.ok(argv.includes("--ignore-user-config"));
  assert.ok(argv.includes("--ignore-rules"));
});

test("buildArgv uses isolated Codex defaults when optional model fields are empty", () => {
  const argv = buildArgv({
    vaultPath: VAULT,
    cacheDir: CACHE,
    url: URL,
    skillPath: SKILL,
    codexHome: CODEX_HOME,
    userHome: USER_HOME,
    pythonPath: PYTHON,
    pythonReadRoots: [PYTHON_ROOT],
  });
  assert.strictEqual(argv.includes("--model"), false);
  assert.strictEqual(argv.some((value) => /^model_reasoning_effort=/.test(value)), false);
});

test("Codex permission profile denies private and Obsidian configuration roots", () => {
  assert.strictEqual(resolveUserHome({ HOME: USER_HOME }), USER_HOME);
  assert.strictEqual(resolveCodexHome({ CODEX_HOME }), CODEX_HOME);
  assert.strictEqual(
    permissionProfileConfig({
      codexHome: CODEX_HOME,
      userHome: USER_HOME,
      vaultPath: VAULT,
      skillPath: SKILL,
      pythonReadRoots: [PYTHON_ROOT],
    }),
    `permissions.paperreader={extends=":workspace",filesystem={":root"="deny",":minimal"="read",":tmpdir"="deny",":slash_tmp"="deny",${JSON.stringify(CODEX_HOME)}="deny",${JSON.stringify(path.join(USER_HOME, ".ssh"))}="deny",${JSON.stringify(path.join(VAULT, ".obsidian"))}="deny",${JSON.stringify(SKILL_DIR)}="read",${JSON.stringify(PYTHON_ROOT)}="read"},network={enabled=true}}`
  );
  assert.strictEqual(safeVaultPath(VAULT, USER_HOME), VAULT);
  assert.throws(() => safeVaultPath(USER_HOME, USER_HOME), /user-home root/);
  const nestedHome = path.join(ROOT, "Users", "paperreader-user");
  assert.throws(() => safeVaultPath(path.dirname(nestedHome), nestedHome), /contain.*user-home/);
  assert.throws(
    () => safeVaultPath(path.join(nestedHome, "Library"), nestedHome),
    /dedicated folder/
  );
  assert.strictEqual(
    safeVaultPath(path.join(nestedHome, "PaperReadingDaily"), nestedHome),
    path.join(nestedHome, "PaperReadingDaily")
  );
  assert.throws(
    () =>
      assertRuntimePathsSeparated({
        vaultPath: path.dirname(CACHE),
        cacheDir: CACHE,
        codexHome: CODEX_HOME,
        userHome: USER_HOME,
      }),
    /App userData/
  );
  assert.throws(
    () =>
      assertRuntimePathsSeparated({
        vaultPath: CODEX_HOME,
        cacheDir: CACHE,
        codexHome: CODEX_HOME,
        userHome: USER_HOME,
      }),
    /Codex home/
  );
  assert.deepStrictEqual(
    safeReadRoots([PYTHON_ROOT, PYTHON_ROOT, ROOT, USER_HOME, CODEX_HOME], CODEX_HOME, USER_HOME),
    [PYTHON_ROOT]
  );
  assert.strictEqual(safePythonExecutable(PYTHON, [PYTHON_ROOT]), PYTHON);
  assert.throws(
    () => safePythonExecutable(path.join(USER_HOME, "bin", "python3"), [PYTHON_ROOT]),
    /inside a probed read root/
  );
  assert.throws(
    () => resolveCodexHome({ CODEX_HOME: "relative/.codex" }),
    /absolute Codex home/
  );
  assert.throws(
    () => permissionProfileConfig({ codexHome: CODEX_HOME, vaultPath: VAULT, skillPath: SKILL }),
    /Python runtime read roots/
  );
});

test("Codex child closes stdin, receives app cache, and never inherits API credentials", () => {
  const env = spawnEnvironment("/opt/codex/bin/codex", CACHE, {
    PATH: "/usr/bin",
    OPENAI_API_KEY: "do-not-forward",
    CODEX_API_KEY: "do-not-forward",
    CODEX_ACCESS_TOKEN: "do-not-forward",
    CODEX_HOME: "/safe/codex-home",
    KEEP_ME: "yes",
  });
  assert.strictEqual(env.PAPERREADER_CACHE_DIR, CACHE);
  assert.strictEqual(env.CODEX_HOME, "/safe/codex-home");
  assert.strictEqual(env.KEEP_ME, "yes");
  for (const name of ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"]) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(env, name), false);
  }
  assert.deepStrictEqual(spawnOptions(VAULT, env).stdio, ["ignore", "pipe", "pipe"]);
  assert.throws(
    () => spawnEnvironment("/opt/codex/bin/codex", "/paper-vault/.cache", {}),
    /app-owned paper-cache/
  );
});
