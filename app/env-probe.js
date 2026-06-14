// Detect the runtime prerequisites: the Obsidian vault (with the paper-reading
// skill) and the claude CLI. Used on first run and by the settings window.

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { resolveClaudePath } = require("./spawn-claude");

function isVault(p) {
  try {
    return !!p && fs.existsSync(path.join(p, ".obsidian"));
  } catch {
    return false;
  }
}
function hasSkill(p) {
  try {
    return fs.existsSync(path.join(p, ".claude", "skills", "paper-reading", "SKILL.md"));
  } catch {
    return false;
  }
}

// Best-effort defaults for a fresh install: the known vault location and the
// auto-resolved claude path.
function detectDefaults() {
  const out = { vaultPath: "", claudePath: "" };
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    "F:\\Obsidian_values\\PaperReadingDaily",
    home && path.join(home, "Obsidian", "PaperReadingDaily"),
    home && path.join(home, "Documents", "PaperReadingDaily"),
  ].filter(Boolean);
  for (const v of candidates) {
    if (isVault(v) && hasSkill(v)) {
      out.vaultPath = v;
      break;
    }
  }
  const c = resolveClaudePath("");
  if (c) out.claudePath = c;
  return out;
}

function probeEnv(settings) {
  const s = settings || {};
  const vaultPath = s.vaultPath || "";
  const vault = { path: vaultPath, ok: false, reason: "" };
  if (!vaultPath) vault.reason = "未设置 vault 路径";
  else if (!fs.existsSync(vaultPath)) vault.reason = "路径不存在";
  else if (!isVault(vaultPath)) vault.reason = "不是 Obsidian vault（缺 .obsidian/）";
  else if (!hasSkill(vaultPath)) vault.reason = "缺少 paper-reading 技能";
  else vault.ok = true;

  const claudePath = resolveClaudePath(s.claudePath);
  const claude = {
    path: claudePath || "",
    ok: !!claudePath,
    version: "",
    reason: claudePath ? "" : "未找到 claude（请在设置中指定路径）",
  };
  if (claudePath) {
    try {
      claude.version = execFileSync(claudePath, ["--version"], {
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
      }).trim();
    } catch (e) {
      claude.ok = false;
      claude.reason = "claude 无法执行：" + e.message;
    }
  }

  return { vault, claude, ready: vault.ok && claude.ok };
}

module.exports = { probeEnv, detectDefaults, isVault, hasSkill };
