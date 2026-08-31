"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

const DOCUMENT_PAIRS = Object.freeze([
  ["README.md", "README_ZH.md"],
  ["app/README.md", "app/README_ZH.md"],
  ["RELEASES_NOTES.md", "RELEASES_NOTES_ZH.md"],
  ["SECURITY.md", "SECURITY_ZH.md"],
  ["CONTRIBUTING.md", "CONTRIBUTING_ZH.md"],
  ["RELEASE_CHECKLIST.md", "RELEASE_CHECKLIST_ZH.md"],
  ["docs/WINDOWS_ROADMAP.md", "docs/WINDOWS_ROADMAP_ZH.md"],
]);

const CORE_DOCUMENTS = Object.freeze(DOCUMENT_PAIRS.flat());

function read(relative) {
  const absolute = path.join(ROOT, relative);
  assert.ok(fs.existsSync(absolute), `${relative} must exist`);
  return fs.readFileSync(absolute, "utf8");
}

function normalizeLinkTarget(raw) {
  let target = String(raw || "").trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  } else {
    target = target.split(/\s+/u, 1)[0];
  }
  target = target.replace(/[?#].*$/u, "");
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function stripMarkdownFences(markdown) {
  let fence = null;
  return String(markdown || "")
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1] || "";
      if (marker && !fence) {
        fence = { character: marker[0], length: marker.length };
        return "";
      }
      if (
        marker &&
        fence &&
        marker[0] === fence.character &&
        marker.length >= fence.length
      ) {
        fence = null;
        return "";
      }
      return fence ? "" : line;
    })
    .join("\n");
}

function stripMarkdownCode(markdown) {
  return stripMarkdownFences(markdown).replace(/(`+)[^`\n]*\1/gu, "");
}

function markdownTargets(markdown) {
  const prose = stripMarkdownCode(markdown);
  const targets = [];
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;
  for (const match of prose.matchAll(pattern)) {
    const target = normalizeLinkTarget(match[1]);
    if (target) targets.push(target);
  }
  const referenceDefinition = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/gmu;
  for (const match of prose.matchAll(referenceDefinition)) {
    const target = normalizeLinkTarget(match[1]);
    if (target) targets.push(target);
  }
  return targets;
}

function resolvedLocalTarget(sourceRelative, target) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target) || target.startsWith("#")) {
    return null;
  }
  if (target.startsWith("/")) return path.resolve(ROOT, target.slice(1));
  return path.resolve(ROOT, path.dirname(sourceRelative), target);
}

function resolvedRepositoryBlobTarget(target) {
  const match = String(target || "").match(
    /^https:\/\/github\.com\/Robotics-paper-daily\/Robotics-paper-daily\.github\.io\/blob\/[^/]+\/(.+)$/u
  );
  return match ? path.resolve(ROOT, match[1]) : null;
}

function linksTo(sourceRelative, destinationRelative) {
  const destination = path.resolve(ROOT, destinationRelative);
  return markdownTargets(read(sourceRelative)).some((target) => {
    const resolved =
      resolvedLocalTarget(sourceRelative, target) ||
      resolvedRepositoryBlobTarget(target);
    return resolved === destination;
  });
}

function proseBlocks(markdown) {
  return stripMarkdownFences(markdown)
    .split(/\n\s*\n/u)
    .map((block) => block.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

function matchingBlock(markdown, patterns, message) {
  const block = proseBlocks(markdown).find((candidate) =>
    patterns.every((pattern) => pattern.test(candidate))
  );
  assert.ok(block, message);
  return block;
}

test("English and Chinese documentation pairs exist and cross-link each other", () => {
  for (const [english, chinese] of DOCUMENT_PAIRS) {
    assert.ok(fs.existsSync(path.join(ROOT, english)), `${english} must exist`);
    assert.ok(fs.existsSync(path.join(ROOT, chinese)), `${chinese} must exist`);
    assert.ok(linksTo(english, chinese), `${english} must link to ${chinese}`);
    assert.ok(linksTo(chinese, english), `${chinese} must link to ${english}`);
  }
});

test("repository links in core Markdown documentation resolve", () => {
  for (const source of CORE_DOCUMENTS) {
    for (const target of markdownTargets(read(source))) {
      const resolved =
        resolvedLocalTarget(source, target) ||
        resolvedRepositoryBlobTarget(target);
      if (!resolved) continue;
      const relativeToRoot = path.relative(ROOT, resolved);
      assert.ok(
        relativeToRoot !== ".." && !relativeToRoot.startsWith(`..${path.sep}`),
        `${source} links outside the repository: ${target}`
      );
      assert.ok(
        fs.existsSync(resolved),
        `${source} links to missing local target ${target}`
      );
    }
  }
});

test("core documentation contains no retired automatic-update surface", () => {
  const retiredUpdateTerms =
    /electron[ _-]*updater|auto[ _-]*updat(?:e|es|er|ing)|automatic[ _-]*updat(?:e|es|er|ing)|(?:in[ -]app|self)[ -]updat(?:e|es|er|ing)|app-update\.ya?ml|latest-mac(?:\.ya?ml)?|\bblockmap\b|自动更新|自动升级|应用内(?:更新|升级)/iu;
  for (const source of CORE_DOCUMENTS) {
    assert.doesNotMatch(read(source), retiredUpdateTerms, source);
  }
});

test("README and App guides describe Windows as planned and unsupported", () => {
  const englishDocs = ["README.md", "app/README.md"];
  const chineseDocs = ["README_ZH.md", "app/README_ZH.md"];

  for (const source of englishDocs) {
    const contents = read(source);
    matchingBlock(
      contents,
      [/\bWindows\b/iu, /\bplanned\b/iu, /\b(?:not (?:yet )?supported|unsupported)\b/iu],
      `${source} must describe Windows as planned and unsupported in one passage`
    );
    const launcherContext = matchingBlock(
      contents,
      [/run-windows\.bat/iu, /\b(?:source|development)\b/iu],
      `${source} must describe run-windows.bat as a source/development helper`
    );
    assert.match(launcherContext, /\b(?:source|development)\b/iu, source);
    assert.match(
      launcherContext,
      /\bnot\b[\s\S]{0,80}\b(?:product|release|installer|supported)\b/iu,
      `${source} must say run-windows.bat is not a supported product entry point`
    );
  }

  for (const source of chineseDocs) {
    const contents = read(source);
    matchingBlock(
      contents,
      [/Windows/iu, /(?:规划|计划)/u, /(?:尚未支持|暂不支持|不支持|未支持)/u],
      `${source} 必须在同一段说明 Windows 已规划但尚不受支持`
    );
    const launcherContext = matchingBlock(
      contents,
      [/run-windows\.bat/iu, /(?:源码|开发)/u],
      `${source} 必须说明 run-windows.bat 只是源码/开发辅助脚本`
    );
    assert.match(launcherContext, /(?:源码|开发)/u, source);
    assert.match(
      launcherContext,
      /(?:不是|并非|不属于|非)[\s\S]{0,60}(?:产品|发布|安装包|受支持)/u,
      `${source} 必须说明 run-windows.bat 不是受支持的产品入口`
    );
  }
});

test("README and App guides link to the language-matched Windows roadmap", () => {
  for (const source of ["README.md", "app/README.md"]) {
    assert.ok(linksTo(source, "docs/WINDOWS_ROADMAP.md"), `${source} must link to English roadmap`);
  }
  for (const source of ["README_ZH.md", "app/README_ZH.md"]) {
    assert.ok(
      linksTo(source, "docs/WINDOWS_ROADMAP_ZH.md"),
      `${source} must link to Chinese roadmap`
    );
  }
});

test("App guides distinguish AI read concurrency from the fixed Zotero PDF queue", () => {
  const english = read("app/README.md");
  matchingBlock(
    english,
    [
      /\bAI\b/iu,
      /\bconcurrency\b/iu,
      /(?:\bdefault(?:s|ed)?(?:\s+(?:to|is|of)|\s*:)?\s*`?10`?\b|`?10`?\s+by default\b)/iu,
      /\b1\s*(?:-|–|—|to)\s*16\b/iu,
      /\bZotero\b/iu,
      /\b(?:separate|independent|different|distinct|unrelated)\b/iu,
    ],
    "app/README.md must keep the AI concurrency default and range in one passage"
  );
  matchingBlock(
    english,
    [
      /\bZotero\b/iu,
      /\bPDF\b/iu,
      /\bOneDrive\b/iu,
      /(?:\bfixed\b[^.]{0,80}\b(?:4|four)\b|\b(?:4|four)\b[^.]{0,80}\bfixed\b)/iu,
      /\bFIFO\b/iu,
      /(?:\bsame\b[^.]{0,60}\b(?:task|paper|arXiv|operation key)|\b(?:task|paper|arXiv|operation key)\b[^.]{0,60}\bsame\b)/iu,
      /\b(?:coalesc(?:e|es|ed|ing)|merg(?:e|es|ed|ing)|deduplicat(?:e|es|ed|ing))\b/iu,
      /\bAI\b[^.]{0,100}\b(?:separate|independent|different|distinct|unrelated)\b|\b(?:separate|independent|different|distinct|unrelated)\b[^.]{0,100}\bAI\b/iu,
    ],
    "app/README.md must document the separate fixed Zotero PDF/OneDrive queue contract"
  );

  const chinese = read("app/README_ZH.md");
  matchingBlock(
    chinese,
    [
      /AI/iu,
      /(?:并发|concurrency)/iu,
      /(?:默认[^。；\n]{0,30}`?10`?|\|\s*`?concurrency`?\s*\|\s*`?10`?\s*\|)/iu,
      /\b1\s*(?:-|–|—|至|到)\s*16\b/u,
      /Zotero/iu,
      /(?:独立|不同|区分|分开|无关)/u,
    ],
    "app/README_ZH.md 必须在同一段说明 AI 并发默认值和范围"
  );
  matchingBlock(
    chinese,
    [
      /Zotero/iu,
      /PDF/iu,
      /OneDrive/iu,
      /(?:(?:固定|不可配置)[^。；\n]{0,80}(?:`?4`?|四)|(?:`?4`?|四)[^。；\n]{0,80}(?:固定|不可配置))/u,
      /(?:FIFO|先进先出)/iu,
      /(?:同一|相同)[^。；\n]{0,40}(?:任务|论文|arXiv|operation key|操作键)/iu,
      /(?:合并|去重)/u,
      /(?:AI|精读)[^。；\n]{0,120}(?:独立|不同|区分|分开|无关|不是)|(?:独立|不同|区分|分开|无关|不是)[^。；\n]{0,120}(?:AI|精读)/iu,
    ],
    "app/README_ZH.md 必须说明独立且固定的 Zotero PDF/OneDrive 队列契约"
  );
});
