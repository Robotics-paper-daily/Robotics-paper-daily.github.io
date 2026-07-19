const test = require("node:test");
const assert = require("node:assert");
const { loadSearchIndex } = require("../js/search-index");


function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}


test("loadSearchIndex loads manifest shards in order and reports progress", async () => {
  const calls = [];
  const progress = [];
  const fixtures = new Map([
    ["search_index/manifest.json?v=test", { version: 1, total: 3, shards: [
      { file: "2026-01.json", count: 1 },
      { file: "2026-02.json", count: 2 },
    ] }],
    ["search_index/2026-01.json?v=test", [{ title: "one" }]],
    ["search_index/2026-02.json?v=test", [{ title: "two" }, { title: "three" }]],
  ]);
  const fetchImpl = async (url) => {
    calls.push(url);
    return response(fixtures.get(url), fixtures.has(url) ? 200 : 404);
  };

  const result = await loadSearchIndex({
    baseUrl: "search_index/",
    cacheBust: "test",
    fetchImpl,
    onProgress: (state) => progress.push(state),
  });

  assert.deepStrictEqual(result.papers.map((paper) => paper.title), ["one", "two", "three"]);
  assert.deepStrictEqual(calls, [
    "search_index/manifest.json?v=test",
    "search_index/2026-01.json?v=test",
    "search_index/2026-02.json?v=test",
  ]);
  assert.strictEqual(progress.at(-1).loadedPapers, 3);
  assert.strictEqual(progress.at(-1).loadedShards, 2);
});


test("loadSearchIndex uses the runtime's default fetch", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url === "search_index/manifest.json") {
      return response({ version: 1, total: 1, shards: [{ file: "2026-01.json", count: 1 }] });
    }
    return response([{ title: "default fetch" }]);
  };
  try {
    const result = await loadSearchIndex({ cacheBust: false });
    assert.strictEqual(result.papers[0].title, "default fetch");
  } finally {
    global.fetch = originalFetch;
  }
});


test("loadSearchIndex rejects unsafe shard names", async () => {
  const fetchImpl = async () => response({
    version: 1,
    total: 0,
    shards: [{ file: "../search_index.json", count: 0 }],
  });
  await assert.rejects(
    loadSearchIndex({ fetchImpl, cacheBust: false }),
    /invalid search-index shard entry/
  );
});


test("loadSearchIndex rejects a manifest/shard count mismatch", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("manifest.json")) {
      return response({ version: 1, total: 2, shards: [{ file: "2026-01.json", count: 2 }] });
    }
    return response([{ title: "only one" }]);
  };
  await assert.rejects(
    loadSearchIndex({ fetchImpl, cacheBust: false }),
    /shard count mismatch/
  );
});


test("loadSearchIndex can fall back to the bounded legacy index", async () => {
  const fallbackErrors = [];
  const fetchImpl = async (url) => {
    if (url.startsWith("search_index/manifest.json")) return response({}, 404);
    if (url.startsWith("search_index.json")) return response([{ title: "legacy" }]);
    return response({}, 404);
  };
  const result = await loadSearchIndex({
    fetchImpl,
    legacyUrl: "search_index.json",
    cacheBust: "test",
    onFallback: (error) => fallbackErrors.push(error),
  });
  assert.strictEqual(result.legacy, true);
  assert.strictEqual(result.papers[0].title, "legacy");
  assert.strictEqual(fallbackErrors.length, 1);
});
