const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const {
  buildPrompt,
  buildArgv,
  spawnOptions,
  spawnEnvironment,
  parseModels,
} = require("../app/spawn-trae");

const VAULT = "/paper-reader-test-vault";
const URL = "https://arxiv.org/abs/2608.01234";
const SKILL = path.join(
  path.parse(process.cwd()).root,
  "paper-reader-bundled",
  "skills",
  "paper-reading",
  "SKILL.md"
);
const CACHE = path.join(path.parse(process.cwd()).root, "paper-reader-user-data", "paper-cache");
const PYTHON = path.join(path.parse(process.cwd()).root, "python-runtime", "bin", "python3");

function assertHeadlessSkillPrompt(prompt) {
  assert.match(prompt, /read[\s\S]*paper-reading[\s\S]*SKILL\.md/i);
  assert.match(prompt, /do not ask (?:me )?(?:any )?questions/i);
  assert.ok(prompt.includes(SKILL));
}

test("buildPrompt directs a URL read through paper-reading SKILL.md without questions", () => {
  const prompt = buildPrompt({ url: URL, skillPath: SKILL });

  assertHeadlessSkillPrompt(prompt);
  assert.match(prompt, new RegExp(URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(prompt, /overwrite it without asking/i);
});

test("buildPrompt directs a title query through paper-reading SKILL.md without questions", () => {
  const query = "A robot paper described only by title";
  const prompt = buildPrompt({ query, skillPath: SKILL });

  assertHeadlessSkillPrompt(prompt);
  assert.match(prompt, new RegExp(query));
  assert.match(prompt, /arXiv/i);
  assert.match(prompt, /stop instead of guessing/i);
});

test("buildArgv produces the complete default Trae headless invocation", () => {
  const argv = buildArgv({ vaultPath: VAULT, url: URL, skillPath: SKILL });
  const prompt = argv.at(-1);

  assertHeadlessSkillPrompt(prompt);
  assert.deepStrictEqual(argv, [
    "--search",
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--permission-mode",
    "bypass_permissions",
    "--color",
    "never",
    "-C",
    VAULT,
    "-m",
    "gpt-5.4",
    "-c",
    'model_provider="trae"',
    "-c",
    'model_backend_variant="max"',
    "-c",
    'model_reasoning_effort="ultra"',
    prompt,
  ]);
});

test("buildArgv uses explicit model, backend, effort, and permission values", () => {
  const argv = buildArgv({
    vaultPath: VAULT,
    query: "Dexterous manipulation with tactile sensing",
    model: "gpt-5.5",
    backendVariant: "fast",
    reasoningEffort: "high",
    permissionMode: "auto",
    skillPath: SKILL,
  });

  assert.deepStrictEqual(argv.slice(0, -1), [
    "--search",
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--permission-mode",
    "auto",
    "--color",
    "never",
    "-C",
    VAULT,
    "-m",
    "gpt-5.5",
    "-c",
    'model_provider="trae"',
    "-c",
    'model_backend_variant="fast"',
    "-c",
    'model_reasoning_effort="high"',
  ]);
  assertHeadlessSkillPrompt(argv.at(-1));
  assert.match(argv.at(-1), /Dexterous manipulation with tactile sensing/);
});

test("buildArgv maps an unknown legacy permission mode to Trae default", () => {
  const argv = buildArgv({
    vaultPath: VAULT,
    url: URL,
    permissionMode: "acceptEdits",
    skillPath: SKILL,
  });
  assert.strictEqual(argv[argv.indexOf("--permission-mode") + 1], "default");
});

test("spawnOptions closes stdin so Trae exec doesn't block waiting for EOF", () => {
  const opts = spawnOptions(VAULT, { PATH: "/x" });
  assert.deepStrictEqual(opts.stdio, ["ignore", "pipe", "pipe"]);
  assert.strictEqual(opts.cwd, VAULT);
  assert.strictEqual(opts.shell, false);
});

test("spawnEnvironment passes the app cache and probed Python to Trae", () => {
  const env = spawnEnvironment("/opt/trae/trae-cli", CACHE, PYTHON, {
    PATH: "/usr/bin",
    KEEP_ME: "yes",
  });
  assert.strictEqual(env.PAPERREADER_CACHE_DIR, CACHE);
  assert.strictEqual(env.PAPERREADER_PYTHON, PYTHON);
  assert.strictEqual(env.KEEP_ME, "yes");
  assert.throws(
    () => spawnEnvironment("/opt/trae/trae-cli", "/paper-vault/.cache", PYTHON, {}),
    /app-owned paper-cache/
  );
  assert.throws(
    () => spawnEnvironment("/opt/trae/trae-cli", CACHE, "python3", {}),
    /absolute probed Python/
  );
});

test("parseModels extracts name, load, max support, and quota depletion", () => {
  const json = JSON.stringify([
    {
      name: "gpt-5.4",
      context_window: 200000,
      _meta: { trae: { supportsMaxMode: true, load: { percent: 96 } } },
    },
    {
      name: "openrouter-1o",
      _meta: { trae: { supportsMaxMode: false, weeklyQuota: { applies: true, isDepleted: true } } },
    },
    { not_a_model: true },
  ]);
  const models = parseModels(json);
  assert.strictEqual(models.length, 2);
  assert.deepStrictEqual(models[0], {
    name: "gpt-5.4",
    load: 96,
    supportsMaxMode: true,
    contextWindow: 200000,
    quotaApplies: false,
    quotaDepleted: false,
  });
  assert.strictEqual(models[1].name, "openrouter-1o");
  assert.strictEqual(models[1].load, null);
  assert.strictEqual(models[1].quotaDepleted, true);
});

test("parseModels tolerates malformed JSON", () => {
  assert.deepStrictEqual(parseModels("not json"), []);
  assert.deepStrictEqual(parseModels("{}"), []);
});
