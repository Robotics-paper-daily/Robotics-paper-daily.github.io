// Tests for the read-only Zotero reconcile query added to js/zotero.js.
// Loads the real browser file in a vm sandbox with a mocked global fetch, so we
// exercise the actual ZoteroClient (pagination, subtree walk, arxiv matching) —
// not a reimplementation. Run: node --test test/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "zotero.js"), "utf8");

function makeRes(body, { status = 200, total } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (h) =>
        h.toLowerCase() === "total-results" && total != null ? String(total) : null,
    },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

// Load js/zotero.js bound to the given fetch mock; returns the sandbox window.
function loadZotero(fetchMock) {
  const sandbox = { window: {}, fetch: fetchMock, URLSearchParams, console };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "zotero.js" });
  return sandbox.window;
}

test("baseArxivId strips the version suffix", () => {
  const win = loadZotero(async () => makeRes([]));
  assert.strictEqual(win.baseArxivId("2606.13675v1"), "2606.13675");
  assert.strictEqual(win.baseArxivId("2604.25459"), "2604.25459");
  assert.strictEqual(win.baseArxivId(null), null);
});

test("listDailyPaperArxivMap maps base arxiv ids of items inside the Daily Paper tree only", async () => {
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("/collections/top")) {
      return makeRes(
        [{ key: "ROOT", data: { key: "ROOT", name: "Daily Paper", parentCollection: false } }],
        { total: 1 }
      );
    }
    if (u.includes("/collections?")) {
      return makeRes(
        [
          { key: "ROOT", data: { name: "Daily Paper", parentCollection: false } },
          { key: "D1", data: { name: "2026-06-14", parentCollection: "ROOT" } },
          { key: "OTHER", data: { name: "Reading List", parentCollection: false } },
        ],
        { total: 3 }
      );
    }
    if (u.includes("/items?")) {
      return makeRes(
        [
          // in the tree (D1) — archiveID with version → matched, version stripped
          { key: "ITEM1", data: { archiveID: "2606.13675v1", collections: ["D1"], url: "http://arxiv.org/abs/2606.13675v1" } },
          // outside the tree (OTHER) → excluded even though it is a preprint
          { key: "ITEM2", data: { DOI: "10.48550/arXiv.2604.25459", collections: ["OTHER"], url: "" } },
          // in the tree, id only resolvable via DOI
          { key: "ITEM3", data: { DOI: "10.48550/arXiv.2605.00001", collections: ["D1", "OTHER"], url: "" } },
        ],
        { total: 3 }
      );
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");
  const map = await client.listDailyPaperArxivMap("Daily Paper");
  // spread to bring vm-realm object's own props into this realm (prototype differs)
  assert.deepStrictEqual({ ...map }, { "2606.13675": "ITEM1", "2605.00001": "ITEM3" });
});

test("listDailyPaperArxivMap returns {} and skips item fetch when the root collection is absent", async () => {
  let itemsFetched = false;
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("/collections/top")) return makeRes([], { total: 0 }); // no Daily Paper
    if (u.includes("/items?")) itemsFetched = true;
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");
  const map = await client.listDailyPaperArxivMap("Daily Paper");
  assert.deepStrictEqual({ ...map }, {});
  assert.strictEqual(itemsFetched, false);
});

test("like.js loads cleanly (IIFE executes without throwing) in a browser-like sandbox", () => {
  const LIKE = fs.readFileSync(path.join(__dirname, "..", "js", "like.js"), "utf8");
  const noop = () => {};
  const storage = () => ({ getItem: () => null, setItem: noop, removeItem: noop });
  const sandbox = {
    window: {},
    document: {
      readyState: "loading", // defer init() so the IIFE only defines, never runs
      addEventListener: noop,
      getElementById: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ classList: { add: noop, toggle: noop }, appendChild: noop, style: {}, querySelector: () => null }),
      body: { appendChild: noop, classList: { add: noop } },
      head: { appendChild: noop },
    },
    sessionStorage: storage(),
    localStorage: storage(),
    console,
  };
  vm.createContext(sandbox);
  assert.doesNotThrow(() => vm.runInContext(LIKE, sandbox, { filename: "like.js" }));
});

test("listDailyPaperArxivMap paginates the items endpoint", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    key: `K${i}`,
    data: { archiveID: `2600.${String(i).padStart(5, "0")}`, collections: ["D1"] },
  }));
  const page2 = [{ key: "KLAST", data: { archiveID: "2600.99999", collections: ["D1"] } }];
  let itemCalls = 0;
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("/collections/top")) {
      return makeRes([{ key: "ROOT", data: { key: "ROOT", name: "Daily Paper", parentCollection: false } }], { total: 1 });
    }
    if (u.includes("/collections?")) {
      return makeRes(
        [
          { key: "ROOT", data: { name: "Daily Paper", parentCollection: false } },
          { key: "D1", data: { name: "2026-06-14", parentCollection: "ROOT" } },
        ],
        { total: 2 }
      );
    }
    if (u.includes("/items?")) {
      itemCalls += 1;
      return makeRes(u.includes("start=100") ? page2 : page1, { total: 101 });
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");
  const map = await client.listDailyPaperArxivMap("Daily Paper");
  assert.strictEqual(itemCalls, 2, "should fetch two item pages");
  assert.strictEqual(Object.keys(map).length, 101);
  assert.strictEqual(map["2600.99999"], "KLAST");
});
