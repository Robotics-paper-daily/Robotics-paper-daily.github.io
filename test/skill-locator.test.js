const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  findPaperReadingSkill,
  findBundledPaperReadingSkill,
  paperReadingSkillCandidates,
} = require("../app/skill-locator");

// The skill now ships in the repo at skills/paper-reading and is preferred over
// any vault-local copy, so reads no longer depend on the Obsidian-synced vault.
test("the bundled repo skill exists and is resolved", () => {
  const bundled = findBundledPaperReadingSkill();
  assert.ok(bundled, "expected a bundled skill path");
  assert.match(bundled, /skills[\\/]paper-reading[\\/]SKILL\.md$/);
  assert.ok(fs.existsSync(bundled), "bundled SKILL.md should exist on disk");
});

test("findPaperReadingSkill prefers the bundled skill over a vault copy", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "skill-vault-"));
  // Plant a vault-local skill that must NOT win over the bundled one.
  const vaultSkillDir = path.join(vault, ".claude", "skills", "paper-reading");
  fs.mkdirSync(vaultSkillDir, { recursive: true });
  fs.writeFileSync(path.join(vaultSkillDir, "SKILL.md"), "vault copy");

  const resolved = findPaperReadingSkill(vault, "claude");
  assert.strictEqual(resolved, findBundledPaperReadingSkill());
  assert.doesNotMatch(resolved, new RegExp(vault.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  fs.rmSync(vault, { recursive: true, force: true });
});

test("findPaperReadingSkill resolves even for a vault with no skill", () => {
  // No vault-local skill anywhere → still resolves (to the bundled one).
  const resolved = findPaperReadingSkill("/nonexistent-vault-xyz", "trae");
  assert.strictEqual(resolved, findBundledPaperReadingSkill());
});

test("paperReadingSkillCandidates still lists provider-specific vault fallbacks", () => {
  const codex = paperReadingSkillCandidates("/v", "codex");
  assert.ok(codex.some((p) => p.includes(path.join(".agents", "skills"))));
  assert.ok(codex.some((p) => p.includes(path.join(".codex", "skills"))));
  const trae = paperReadingSkillCandidates("/v", "trae");
  assert.ok(trae.some((p) => p.includes(path.join(".agents", "skills"))));
  assert.ok(trae.some((p) => p.includes(path.join(".trae", "skills"))));
  assert.ok(trae.some((p) => p.includes(path.join(".claude", "skills"))));
  const claude = paperReadingSkillCandidates("/v", "claude");
  assert.strictEqual(claude.length, 1);
  assert.ok(claude[0].includes(path.join(".claude", "skills")));
  assert.deepStrictEqual(paperReadingSkillCandidates("", "trae"), []);
});
