const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Normalize line endings so the structural regexes below work on a Windows
// checkout (git autocrlf) exactly as they do on the LF repository content.
const renderer = fs
  .readFileSync(path.join(__dirname, "..", "app", "renderer.js"), "utf8")
  .replace(/\r\n/g, "\n");

test("paper-read derives the confirmed arXiv id from the validated URL", () => {
  const paperRead = renderer.match(/case "paper:read": \{([\s\S]*?)\n    \}\n    case "job:list"/);
  assert.ok(paperRead, "paper:read RPC handler should be present");
  assert.match(paperRead[1], /const derivedArxivId = arxivIdentity\(url\)/);
  assert.match(paperRead[1], /arxivId: derivedArxivId/);
  assert.doesNotMatch(paperRead[1], /p\.arxivId/);
  assert.match(paperRead[1], /identity: request\.arxivId/);
});

test("every privileged report operation consumes a real one-shot gesture", () => {
  for (const action of ["paper-read", "vault-open", "vault-update", "zotero-add", "zotero-remove"]) {
    assert.match(renderer, new RegExp(`requireReportGesture\\("${action}"`));
  }
  assert.doesNotMatch(renderer, /requireReportConfirmation|confirmReportAction|CONFIRMATION_COOLDOWN/);
  assert.match(renderer, /navigator\.userActivation\.isActive !== true/);
  assert.match(renderer, /bridge\.consumeReportGesture/);
});

test("read-only report reconciliation does not consume a mutation gesture", () => {
  const jobList = renderer.match(/case "job:list": \{([\s\S]*?)\n    \}\n    case "vault:readPapers"/);
  const readPapers = renderer.match(/case "vault:readPapers": \{([\s\S]*?)\n    \}\n    case "vault:openNote"/);
  const zoteroList = renderer.match(/case "zotero:list": \{([\s\S]*?)\n    \}\n    default:/);
  assert.ok(jobList && readPapers && zoteroList);
  assert.doesNotMatch(jobList[1], /requireReportGesture/);
  assert.doesNotMatch(readPapers[1], /requireReportGesture/);
  assert.doesNotMatch(zoteroList[1], /requireReportGesture/);
});

test("whole-library presence never grants a report an external Zotero item reference", () => {
  const zoteroAdd = renderer.match(/case "zotero:add": \{([\s\S]*?)\n    \}\n    case "zotero:remove"/);
  const zoteroList = renderer.match(/case "zotero:list": \{([\s\S]*?)\n    \}\n    default:/);
  assert.ok(zoteroAdd && zoteroList);
  assert.match(zoteroAdd[1], /managed \? "managed" : "existing"/);
  assert.match(zoteroAdd[1], /\.\.\.\(itemRef \? \{ itemKey: itemRef \} : \{\}\)/);
  assert.match(zoteroList[1], /match\.state === "managed" && match\.itemKey/);
  assert.match(zoteroList[1], /scoped\[baseId\] = \{ state: "existing" \}/);
});

test("report removal binds the opaque reference to its original arXiv identity", () => {
  assert.match(
    renderer,
    /paperReaderZotero\.remove\(record\.itemKey, record\.baseId\)/
  );
  assert.match(renderer, /remove\(itemKey, expectedBaseId\)/);
});
