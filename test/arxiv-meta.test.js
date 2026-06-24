const test = require("node:test");
const assert = require("node:assert");
const { arxivIdFromInput, parseArxivAtom } = require("../app/arxiv-meta");

test("arxivIdFromInput extracts ids from urls and bare ids", () => {
  assert.strictEqual(arxivIdFromInput("https://arxiv.org/abs/2401.12345"), "2401.12345");
  assert.strictEqual(arxivIdFromInput("https://arxiv.org/abs/2401.12345v2"), "2401.12345v2");
  assert.strictEqual(arxivIdFromInput("http://arxiv.org/pdf/2401.12345v2.pdf"), "2401.12345v2");
  assert.strictEqual(arxivIdFromInput("2401.12345"), "2401.12345");
  assert.strictEqual(arxivIdFromInput("2401.12345v3"), "2401.12345v3");
  assert.strictEqual(arxivIdFromInput("arXiv:2401.12345"), "2401.12345");
  assert.strictEqual(arxivIdFromInput("hep-th/9901001"), "hep-th/9901001");
  assert.strictEqual(arxivIdFromInput("https://arxiv.org/abs/hep-th/9901001"), "hep-th/9901001");
});

test("arxivIdFromInput returns null when there is no id (e.g. a paper name)", () => {
  assert.strictEqual(arxivIdFromInput("RT-2: Vision-Language-Action Models"), null);
  assert.strictEqual(arxivIdFromInput("diffusion policy 2024"), null);
  assert.strictEqual(arxivIdFromInput(""), null);
  assert.strictEqual(arxivIdFromInput(null), null);
});

const ATOM_OK = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v2</id>
    <published>2024-01-22T18:00:00Z</published>
    <title>Vision &amp; Action: A Great Paper</title>
    <summary>  This is the abstract.
    It spans lines.  </summary>
    <author><name>Alice Smith</name></author>
    <author><name>Bob Jones</name></author>
    <category term="cs.RO" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

test("parseArxivAtom pulls title/summary/authors/categories/date/url", () => {
  const m = parseArxivAtom(ATOM_OK, "2401.12345");
  assert.strictEqual(m.title, "Vision & Action: A Great Paper");
  assert.strictEqual(m.summary, "This is the abstract. It spans lines.");
  assert.strictEqual(m.published, "2024-01-22");
  assert.deepStrictEqual(m.authors, ["Alice Smith", "Bob Jones"]);
  assert.deepStrictEqual(m.categories, ["cs.RO", "cs.AI"]);
  assert.strictEqual(m.url, "https://arxiv.org/abs/2401.12345v2");
});

const ATOM_ERR = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/api/errors#incorrect_id_format</id><title>Error</title><summary>incorrect id format</summary></entry></feed>`;

test("parseArxivAtom returns null for arXiv error / not-found entries", () => {
  assert.strictEqual(parseArxivAtom(ATOM_ERR, "bad"), null);
  assert.strictEqual(parseArxivAtom("<feed></feed>", "x"), null);
});
