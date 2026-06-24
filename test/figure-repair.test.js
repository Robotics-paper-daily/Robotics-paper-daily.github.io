const test = require("node:test");
const assert = require("node:assert");
const { parseFigureRefs } = require("../app/figure-repair");

test("parseFigureRefs extracts attachment figure embeds (incl. |size suffix)", () => {
  const md = [
    "intro text",
    "![[2026-06-15/attachments/2606.15768/fig2.png]]",
    "*Figure 2*",
    "![[2026-06-14/attachments/2606.09749/fig1.png|1050]]",
    "![[2026-06-15/attachments/2606.15768/fig_3.jpg]]",
    "![[misc/banner.png]]",
    "![[2026/attachments/x/notafig.png]]",
  ].join("\n");
  const refs = parseFigureRefs(md);
  assert.strictEqual(refs.length, 3);
  assert.deepStrictEqual(refs[0], {
    rel: "2026-06-15/attachments/2606.15768/fig2.png",
    dir: "2026-06-15/attachments/2606.15768",
    id: "2606.15768",
    num: "2",
    ext: "png",
  });
  assert.deepStrictEqual(refs[1], {
    rel: "2026-06-14/attachments/2606.09749/fig1.png",
    dir: "2026-06-14/attachments/2606.09749",
    id: "2606.09749",
    num: "1",
    ext: "png",
  });
  assert.strictEqual(refs[2].num, "3");
  assert.strictEqual(refs[2].ext, "jpg");
});

test("parseFigureRefs returns [] when there are no figure embeds", () => {
  assert.deepStrictEqual(parseFigureRefs("no images here"), []);
  assert.deepStrictEqual(parseFigureRefs(""), []);
  assert.deepStrictEqual(parseFigureRefs(null), []);
});
