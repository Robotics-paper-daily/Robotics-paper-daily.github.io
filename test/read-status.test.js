// Tests for the manual 已读 checkbox helpers. Run: node --test test/
const test = require("node:test");
const assert = require("node:assert");
const { isReadChecked, setReadInNoteText } = require("../app/read-status");

test("isReadChecked detects checked / unchecked / missing", () => {
  assert.strictEqual(isReadChecked("body\n\n---\n- [x] ✅ 已读\n"), true);
  assert.strictEqual(isReadChecked("body\n\n---\n- [ ] ✅ 已读\n"), false);
  assert.strictEqual(isReadChecked("body\n- [X] 已读"), true); // emoji optional, uppercase X
  assert.strictEqual(isReadChecked("body with no marker"), false);
  assert.strictEqual(isReadChecked(""), false);
});

test("isReadChecked ignores unrelated task checkboxes", () => {
  assert.strictEqual(isReadChecked("- [x] some other task\n- [ ] ✅ 已读"), false);
});

test("setReadInNoteText flips an existing checkbox in place (no duplicate)", () => {
  const note = "# Title\n\nbody\n\n---\n- [ ] ✅ 已读\n";
  const marked = setReadInNoteText(note, true);
  assert.strictEqual(isReadChecked(marked), true);
  assert.strictEqual((marked.match(/已读/g) || []).length, 1, "no duplicate marker");
  const back = setReadInNoteText(marked, false);
  assert.strictEqual(isReadChecked(back), false);
  assert.strictEqual((back.match(/已读/g) || []).length, 1);
});

test("setReadInNoteText appends a marker when the note has none", () => {
  const note = "# Title\n\nbody only";
  const marked = setReadInNoteText(note, true);
  assert.strictEqual(isReadChecked(marked), true);
  assert.match(marked, /\n---\n- \[x\] ✅ 已读\n$/);
  // and the original content is preserved
  assert.match(marked, /^# Title\n\nbody only/);
});

test("setReadInNoteText is idempotent for repeated same-state calls", () => {
  const note = "# T\n\n---\n- [ ] ✅ 已读\n";
  const a = setReadInNoteText(note, true);
  const b = setReadInNoteText(a, true);
  assert.strictEqual(a, b);
});
