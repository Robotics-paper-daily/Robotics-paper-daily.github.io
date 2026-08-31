const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const {
  buildPrompt,
  buildArgv,
  spawnEnvironment,
} = require("../app/spawn-claude");

const URL = "https://arxiv.org/abs/2608.01234";
const SKILL = path.join(
  path.parse(process.cwd()).root,
  "PaperReader Resources",
  "skills",
  "paper-reading",
  "SKILL.md"
);
const CACHE = path.join(path.parse(process.cwd()).root, "PaperReader User Data", "paper-cache");
const PYTHON = path.join(path.parse(process.cwd()).root, "python-runtime", "bin", "python3");

test("Claude prompt names the exact bundled SKILL.md path for URL reads", () => {
  const prompt = buildPrompt({ url: URL, skillPath: SKILL });
  assert.ok(prompt.includes(SKILL));
  assert.ok(prompt.includes(URL));
  assert.match(prompt, /Resolve every relative script or resource path from that skill's directory/);
  assert.match(prompt, /overwrite it without asking/i);
  assert.match(prompt, /do not ask me any questions/i);
});

test("Claude title-query prompt still uses the exact skill and refuses guessing", () => {
  const query = "A robot paper described only by title";
  const prompt = buildPrompt({ query, skillPath: SKILL });
  assert.ok(prompt.includes(SKILL));
  assert.ok(prompt.includes(query));
  assert.match(prompt, /arXiv/i);
  assert.match(prompt, /stop and say so instead of guessing/i);
});

test("Claude prompt rejects a missing or non-absolute skill path", () => {
  assert.throws(() => buildPrompt({ url: URL }), /absolute bundled/);
  assert.throws(
    () => buildPrompt({ url: URL, skillPath: "skills/paper-reading/SKILL.md" }),
    /absolute bundled/
  );
});

test("buildArgv carries the exact skill prompt into the headless invocation", () => {
  const argv = buildArgv({
    url: URL,
    skillPath: SKILL,
    model: "sonnet",
    permissionMode: "bypassPermissions",
    maxBudgetUsd: 4.5,
  });
  assert.strictEqual(argv[0], "-p");
  assert.ok(argv[1].includes(SKILL));
  assert.deepStrictEqual(argv.slice(2), [
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--model",
    "sonnet",
    "--max-budget-usd",
    "4.5",
  ]);
});

test("spawnEnvironment passes app cache and the probed Python without forwarding API keys", () => {
  const env = spawnEnvironment("/opt/claude/bin/claude", CACHE, PYTHON, {
    PATH: "/usr/bin",
    ANTHROPIC_API_KEY: "must-not-leak",
    KEEP_ME: "yes",
  });
  assert.strictEqual(env.PAPERREADER_CACHE_DIR, CACHE);
  assert.strictEqual(env.PAPERREADER_PYTHON, PYTHON);
  assert.strictEqual(env.KEEP_ME, "yes");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(env, "ANTHROPIC_API_KEY"), false);
  assert.throws(
    () => spawnEnvironment("/opt/claude/bin/claude", "/paper-vault/.cache", PYTHON, {}),
    /app-owned paper-cache/
  );
  assert.throws(
    () => spawnEnvironment("/opt/claude/bin/claude", CACHE, "python3", {}),
    /absolute probed Python/
  );
});
