const fs = require("fs");
const path = require("path");

const SKILL_PATHS = {
  codex: [
    path.join(".agents", "skills", "paper-reading", "SKILL.md"),
    path.join(".codex", "skills", "paper-reading", "SKILL.md"),
  ],
  claude: [path.join(".claude", "skills", "paper-reading", "SKILL.md")],
  trae: [
    path.join(".agents", "skills", "paper-reading", "SKILL.md"),
    path.join(".trae", "skills", "paper-reading", "SKILL.md"),
    path.join(".claude", "skills", "paper-reading", "SKILL.md"),
  ],
};

// The skill now ships WITH the app: it lives in the repo at `skills/paper-reading`
// and is packaged into `<app>/Contents/Resources/skills` via electron-builder
// extraResources. That makes it version-controlled and — crucially — keeps it OUT
// of the user's Obsidian vault, so it no longer rides their (slow / full) WebDAV
// sync. `path.join(__dirname, "..", "skills")` resolves to `repo/skills` in dev and
// to `Resources/skills` in a packaged build (skill-locator.js sits one level below
// each), and we also try process.resourcesPath as a belt-and-suspenders fallback.
function bundledSkillRoots() {
  const roots = [path.join(__dirname, "..", "skills")];
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, "skills"));
  return roots;
}

function findBundledPaperReadingSkill() {
  for (const root of bundledSkillRoots()) {
    const candidate = path.join(root, "paper-reading", "SKILL.md");
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

function paperReadingSkillCandidates(vaultPath, provider) {
  if (!vaultPath) return [];
  const rels = SKILL_PATHS[provider] || SKILL_PATHS.codex;
  return rels.map((rel) => path.join(vaultPath, rel));
}

// Prefer the bundled (repo/packaged) skill; fall back to a vault-local skill only
// for backward compatibility with installs that still keep one under the vault.
function findPaperReadingSkill(vaultPath, provider) {
  const bundled = findBundledPaperReadingSkill();
  if (bundled) return bundled;
  for (const candidate of paperReadingSkillCandidates(vaultPath, provider)) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

function hasPaperReadingSkill(vaultPath, provider) {
  return !!findPaperReadingSkill(vaultPath, provider);
}

module.exports = {
  SKILL_PATHS,
  paperReadingSkillCandidates,
  findBundledPaperReadingSkill,
  findPaperReadingSkill,
  hasPaperReadingSkill,
};
