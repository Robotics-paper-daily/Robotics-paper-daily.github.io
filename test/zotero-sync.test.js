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
const MANAGED_TAG = "paperreader-managed-v1";

function makeRes(body, { status = 200, total, libraryVersion } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (h) => {
        if (h.toLowerCase() === "total-results" && total != null) return String(total);
        if (h.toLowerCase() === "last-modified-version" && libraryVersion != null) {
          return String(libraryVersion);
        }
        return null;
      },
    },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

// Load js/zotero.js bound to the given fetch mock; returns the sandbox window.
function loadZotero(fetchMock, windowExtras = {}) {
  const sandbox = { window: { ...windowExtras }, fetch: fetchMock, URLSearchParams, console };
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

test("extractArxivId accepts only the real arxiv.org host", () => {
  const win = loadZotero(async () => makeRes([]));
  assert.strictEqual(
    win.extractArxivId("https://arxiv.org/pdf/hep-th/9901001v2.pdf#page=1"),
    "hep-th/9901001v2"
  );
  assert.strictEqual(win.extractArxivId("https://www.arxiv.org/abs/2608.12345"), "2608.12345");
  assert.strictEqual(win.extractArxivId("https://notarxiv.org/abs/2608.12345"), null);
  assert.strictEqual(win.extractArxivId("https://arxiv.org.evil.test/abs/2608.12345"), null);
});

test("getLibraryVersion reads Zotero's monotonic response header", async () => {
  const win = loadZotero(async () => makeRes({}, { libraryVersion: 4321 }));
  assert.strictEqual(await new win.ZoteroClient("KEY", "USER").getLibraryVersion(), 4321);
});

test("PaperReader provenance tag is stable and required for managed status", async () => {
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("/collections?")) {
      return makeRes(
        [{ key: "ROOT", data: { key: "ROOT", name: "Daily Paper", parentCollection: false } }],
        { total: 1 }
      );
    }
    if (u.includes("/items/top?")) {
      return makeRes(
        [{
          key: "USEROWNED",
          data: {
            itemType: "preprint",
            archiveID: "arXiv:2608.12345",
            collections: ["ROOT"],
            tags: [{ tag: "robotics" }],
          },
        }],
        { total: 1 }
      );
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  assert.strictEqual(win.PAPERREADER_MANAGED_TAG, MANAGED_TAG);
  const inventory = await new win.ZoteroClient("KEY", "USER")
    .listLibraryArxivInventory("Daily Paper");
  assert.deepStrictEqual([...inventory["2608.12345"].libraryKeys], ["USEROWNED"]);
  assert.deepStrictEqual([...inventory["2608.12345"].managedKeys], []);
});

test("Daily Paper reconcile normalizes old-style arXiv ids from archiveID and DOI", async () => {
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("/collections/top")) {
      return makeRes([{ key: "ROOT", data: { key: "ROOT", name: "Daily Paper" } }], { total: 1 });
    }
    if (u.includes("/collections?")) {
      return makeRes(
        [
          { key: "ROOT", data: { name: "Daily Paper", parentCollection: false } },
          { key: "DATE", data: { name: "2026-08-11", parentCollection: "ROOT" } },
        ],
        { total: 2 }
      );
    }
    if (u.includes("/items?")) {
      return makeRes(
        [
          { key: "OLD1", data: { archiveID: "arXiv:hep-th/9901001v2", collections: ["DATE"], tags: [{ tag: MANAGED_TAG }] } },
          { key: "OLD2", data: { DOI: "10.48550/arXiv.cond-mat/0102030v1", collections: ["DATE"], tags: [{ tag: MANAGED_TAG }] } },
        ],
        { total: 2 }
      );
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const map = await new win.ZoteroClient("KEY", "USER").listDailyPaperArxivMap("Daily Paper");
  assert.strictEqual(map["hep-th/9901001"], "OLD1");
  assert.strictEqual(map["cond-mat/0102030"], "OLD2");
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
          { key: "ITEM1", data: { archiveID: "2606.13675v1", repository: "arXiv", collections: ["D1"], url: "http://arxiv.org/abs/2606.13675v1", tags: [{ tag: MANAGED_TAG }] } },
          // outside the tree (OTHER) → excluded even though it is a preprint
          { key: "ITEM2", data: { DOI: "10.48550/arXiv.2604.25459", collections: ["OTHER"], url: "" } },
          // in the tree, id only resolvable via DOI
          { key: "ITEM3", data: { DOI: "10.48550/arXiv.2605.00001", collections: ["D1", "OTHER"], url: "", tags: [{ tag: MANAGED_TAG }] } },
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

test("whole-library inventory includes mixed item types and keeps managed keys narrow", async () => {
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("/collections?")) {
      return makeRes(
        [
          { key: "ROOT", data: { key: "ROOT", name: "Daily Paper", parentCollection: false } },
          { key: "DATE", data: { key: "DATE", name: "2026-08-17", parentCollection: "ROOT" } },
          { key: "OTHER", data: { key: "OTHER", name: "Reading List", parentCollection: false } },
        ],
        { total: 3 }
      );
    }
    if (u.includes("/items/top?")) {
      return makeRes(
        [
          {
            key: "MANAGED1",
            data: {
              itemType: "preprint",
              archiveID: "arXiv:2608.12345v3",
              collections: ["DATE"],
              tags: [{ tag: MANAGED_TAG }],
            },
          },
          {
            key: "OUTSIDE1",
            data: {
              itemType: "preprint",
              DOI: "10.48550/arXiv.2608.12345",
              collections: ["OTHER"],
            },
          },
          {
            key: "WEBPAGE1",
            data: {
              itemType: "webpage",
              url: "https://arxiv.org/abs/2608.54321v2?context=cs.RO",
              collections: ["DATE"],
            },
          },
          {
            key: "ARTICLE1",
            data: {
              itemType: "journalArticle",
              extra: "arXiv: hep-th/9901001v4",
              collections: [],
            },
          },
          {
            key: "DOCUMENT1",
            data: {
              itemType: "document",
              extra: "DOI: 10.48550/arXiv.2607.00001v2",
              collections: ["OTHER"],
            },
          },
          {
            key: "STANDALONE_ATTACHMENT",
            data: {
              itemType: "attachment",
              title: "2608.99998.pdf",
              url: "https://arxiv.org/pdf/2608.99998.pdf",
              collections: [],
            },
          },
          {
            key: "STANDALONE_NOTE",
            data: {
              itemType: "note",
              extra: "arXiv: 2608.99997",
              collections: [],
            },
          },
          {
            key: "LOOKALIKE_HOST",
            data: {
              itemType: "webpage",
              url: "https://notarxiv.org/abs/2608.99996",
              collections: [],
            },
          },
          {
            key: "OTHER_ARCHIVE",
            data: {
              itemType: "journalArticle",
              archiveID: "OtherRepo: 2608.99995",
              repository: "OtherRepo",
              collections: [],
            },
          },
        ],
        { total: 9 }
      );
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const inventory = await new win.ZoteroClient("KEY", "USER").listLibraryArxivInventory(
    "Daily Paper"
  );

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(inventory)),
    {
      "2608.12345": {
        libraryKeys: ["MANAGED1", "OUTSIDE1"],
        managedKeys: ["MANAGED1"],
      },
      "2608.54321": { libraryKeys: ["WEBPAGE1"], managedKeys: [] },
      "hep-th/9901001": { libraryKeys: ["ARTICLE1"], managedKeys: [] },
      "2607.00001": { libraryKeys: ["DOCUMENT1"], managedKeys: [] },
    }
  );
});

test("whole-library inventory paginates both endpoints and deduplicates repeated item keys", async () => {
  const collectionPage = Array.from({ length: 100 }, (_, index) => ({
    key: `C${index}`,
    data: { key: `C${index}`, name: `Collection ${index}`, parentCollection: false },
  }));
  const itemPage = Array.from({ length: 100 }, (_, index) => ({
    key: `I${index}`,
    data: {
      itemType: "preprint",
      archiveID: `2608.${String(index).padStart(5, "0")}v1`,
      repository: "arXiv",
      collections: [],
    },
  }));
  const calls = [];
  const fetchMock = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/collections?")) {
      return u.includes("start=100")
        ? makeRes(
            [{ key: "ROOT", data: { key: "ROOT", name: "Daily Paper", parentCollection: false } }],
            { total: 101 }
          )
        : makeRes(collectionPage, { total: 101 });
    }
    if (u.includes("/items/top?")) {
      return u.includes("start=100")
        ? makeRes(
            [
              {
                key: "I0",
                data: {
                  itemType: "preprint",
                  archiveID: "2608.00000v2",
                  repository: "arXiv",
                  collections: ["ROOT"],
                  tags: [{ tag: MANAGED_TAG }],
                },
              },
              {
                key: "LAST",
                data: {
                  itemType: "preprint",
                  archiveID: "2608.99999v9",
                  repository: "arXiv",
                  collections: ["ROOT"],
                  tags: [{ tag: MANAGED_TAG }],
                },
              },
            ],
            { total: 102 }
          )
        : makeRes(itemPage, { total: 102 });
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const inventory = await new win.ZoteroClient("KEY", "USER").listLibraryArxivInventory(
    "Daily Paper"
  );

  assert.strictEqual(calls.filter((url) => url.includes("/collections?")).length, 2);
  assert.strictEqual(calls.filter((url) => url.includes("/items/top?")).length, 2);
  assert.deepStrictEqual([...inventory["2608.00000"].libraryKeys], ["I0"]);
  assert.deepStrictEqual([...inventory["2608.00000"].managedKeys], ["I0"]);
  assert.deepStrictEqual([...inventory["2608.99999"].libraryKeys], ["LAST"]);
  assert.deepStrictEqual([...inventory["2608.99999"].managedKeys], ["LAST"]);
  assert.strictEqual(Object.keys(inventory).length, 101);
});

test("whole-library inventory still returns presence when Daily Paper is absent", async () => {
  let collectionsStarted = false;
  let itemsStarted = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("/collections?")) collectionsStarted = true;
    if (u.includes("/items/top?")) itemsStarted = true;
    await gate;
    if (u.includes("/items/top?")) {
      return makeRes(
        [
          {
            key: "EXISTING",
            data: {
              itemType: "preprint",
              url: "https://arxiv.org/pdf/2608.22222v2.pdf#page=1",
              collections: [],
            },
          },
        ],
        { total: 1 }
      );
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const operation = new win.ZoteroClient("KEY", "USER").listLibraryArxivInventory(
    "Daily Paper"
  );
  await Promise.resolve();
  assert.strictEqual(collectionsStarted, true);
  assert.strictEqual(itemsStarted, true, "independent inventory reads should start in parallel");
  release();

  const inventory = await operation;
  assert.deepStrictEqual([...inventory["2608.22222"].libraryKeys], ["EXISTING"]);
  assert.deepStrictEqual([...inventory["2608.22222"].managedKeys], []);
});

test("whole-library inventory retries once when pagination observes a version change", async () => {
  let collectionReads = 0;
  let itemReads = 0;
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("/collections?")) {
      collectionReads += 1;
      return makeRes(
        [{ key: "ROOT", data: { key: "ROOT", name: "Daily Paper", parentCollection: false } }],
        { total: 1, libraryVersion: collectionReads === 1 ? 10 : 11 }
      );
    }
    if (u.includes("/items/top?")) {
      itemReads += 1;
      return makeRes(
        [{
          key: "ITEM",
          data: {
            itemType: "preprint",
            archiveID: "arXiv:2608.33333v1",
            collections: ["ROOT"],
            tags: [{ tag: MANAGED_TAG }],
          },
        }],
        { total: 1, libraryVersion: 11 }
      );
    }
    return makeRes([], { total: 0, libraryVersion: 11 });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");
  const inventory = await client.listLibraryArxivInventory("Daily Paper");

  assert.strictEqual(collectionReads, 2);
  assert.strictEqual(itemReads, 2);
  assert.strictEqual(client.lastLibraryInventoryVersion, 11);
  assert.deepStrictEqual([...inventory["2608.33333"].managedKeys], ["ITEM"]);
});

test("whole-library inventory rejects when both snapshot attempts keep drifting", async () => {
  let collectionReads = 0;
  let itemReads = 0;
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("/collections?")) {
      collectionReads += 1;
      return makeRes([], {
        total: 0,
        libraryVersion: collectionReads === 1 ? 20 : 22,
      });
    }
    if (u.includes("/items/top?")) {
      itemReads += 1;
      return makeRes([], {
        total: 0,
        libraryVersion: itemReads === 1 ? 21 : 23,
      });
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");

  await assert.rejects(
    client.listLibraryArxivInventory("Daily Paper"),
    (error) => error && error.code === "ZOTERO_INVENTORY_UNSTABLE"
  );
  assert.strictEqual(collectionReads, 2);
  assert.strictEqual(itemReads, 2);
  assert.strictEqual(client.lastLibraryInventoryVersion, null);
});

test("managed-item revalidation fails closed after a Zotero collection move", async () => {
  let moved = false;
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("/collections?")) {
      return makeRes(
        [
          { key: "ROOT", data: { key: "ROOT", name: "Daily Paper", parentCollection: false } },
          { key: "DATE", data: { key: "DATE", name: "2026-08-17", parentCollection: "ROOT" } },
          { key: "OTHER", data: { key: "OTHER", name: "Other", parentCollection: false } },
        ],
        { total: 3 }
      );
    }
    if (u.includes("/items/ABCDEFGH")) {
      return makeRes({
        key: "ABCDEFGH",
        data: {
          itemType: "preprint",
          archiveID: "arXiv:2608.12345",
          collections: [moved ? "OTHER" : "DATE"],
          tags: [{ tag: MANAGED_TAG }],
        },
      });
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");
  assert.strictEqual(
    await client.isItemManagedInCollectionTree(
      "ABCDEFGH",
      "Daily Paper",
      "2608.12345"
    ),
    true
  );
  assert.strictEqual(
    await client.isItemManagedInCollectionTree(
      "ABCDEFGH",
      "Daily Paper",
      "2608.99999"
    ),
    false
  );
  moved = true;
  assert.strictEqual(
    await client.isItemManagedInCollectionTree("ABCDEFGH", "Daily Paper"),
    false
  );
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

test("like.js renders Zotero and sync states with local SVG icons", () => {
  const LIKE = fs.readFileSync(path.join(__dirname, "..", "js", "like.js"), "utf8");
  for (const name of ["zotero", "loading", "done", "error"]) {
    assert.match(LIKE, new RegExp(`zoteroSvg\\(\\s*"${name}"`), name);
  }
  assert.match(LIKE, /data-zotero-icon=/);
  assert.match(LIKE, /@keyframes zotero-icon-spin/);
  assert.match(LIKE, /zotero-svg-icon-spin/);
  assert.doesNotMatch(LIKE, /<i\b|\b(?:fas|far|fab|fa-[a-z0-9-]+)\b/i);
});

test("like.js labels a scoped report match count without understating the whole library", () => {
  const LIKE = fs.readFileSync(path.join(__dirname, "..", "js", "like.js"), "utf8");
  assert.match(LIKE, /Zotero 已同步（本页匹配 \$\{Object\.keys\(map\)\.length\} 篇）/);
  assert.doesNotMatch(LIKE, /Zotero 已同步（库中 \$\{Object\.keys\(map\)\.length\} 篇）/);
});

test("liked-map writes fail soft when sandbox storage is denied", () => {
  const LIKE = fs.readFileSync(path.join(__dirname, "..", "js", "like.js"), "utf8");
  const match = LIKE.match(/function writeLikedMap\(map\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, "writeLikedMap implementation should be present");
  const writeLikedMap = vm.runInNewContext(`(function (map) {${match[1]}\n})`, {
    LOCAL_LIKED_MAP: "zotero_liked_map",
    JSON,
    localStorage: {
      setItem() {
        const error = new Error("opaque origin");
        error.name = "SecurityError";
        throw error;
      },
    },
  });
  assert.doesNotThrow(() => writeLikedMap({ "https://arxiv.org/abs/2608.1": "ABCDEFGH" }));
});

test("sandboxed App report enables Zotero only through report RPC", () => {
  const LIKE = fs.readFileSync(path.join(__dirname, "..", "js", "like.js"), "utf8");
  const addedClasses = [];
  const noop = () => {};
  const storage = () => ({ getItem: () => null, setItem: noop, removeItem: noop });
  const window = {
    PaperReaderReportBridge: {
      zoteroEnabled: true,
      zotero: {
      isUnlocked: () => true,
      listDailyPaperArxivMap: async () => ({}),
      add: async () => ({}),
      remove: async () => ({}),
      },
    },
    location: { pathname: "/site/daily_html/2026_08_11.html" },
  };
  Object.defineProperty(window, "top", {
    get() {
      throw new Error("sandboxed report must not inspect window.top");
    },
  });
  const sandbox = {
    window,
    document: {
      readyState: "complete",
      getElementById: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ classList: { add: noop }, appendChild: noop, style: {} }),
      body: { appendChild: noop, classList: { add: (name) => addedClasses.push(name) } },
      head: { appendChild: noop },
      documentElement: { appendChild: noop },
    },
    sessionStorage: storage(),
    localStorage: storage(),
    console,
  };
  vm.createContext(sandbox);
  assert.doesNotThrow(() => vm.runInContext(LIKE, sandbox, { filename: "like.js" }));
  assert.deepStrictEqual(addedClasses, ["zotero-mode"]);
});

test("listDailyPaperArxivMap paginates the items endpoint", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    key: `K${i}`,
    data: { archiveID: `2600.${String(i).padStart(5, "0")}`, repository: "arXiv", collections: ["D1"], tags: [{ tag: MANAGED_TAG }] },
  }));
  const page2 = [{ key: "KLAST", data: { archiveID: "2600.99999", repository: "arXiv", collections: ["D1"], tags: [{ tag: MANAGED_TAG }] } }];
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

test("findCollection searches beyond the first 100 results", async () => {
  const firstPage = Array.from({ length: 100 }, (_, i) => ({
    key: `C${i}`,
    data: { key: `C${i}`, name: `Collection ${i}` },
  }));
  const calls = [];
  const fetchMock = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("start=100")) {
      return makeRes(
        [{ key: "TARGET", data: { key: "TARGET", name: "Daily Paper" } }],
        { total: 101 }
      );
    }
    return makeRes(firstPage, { total: 101 });
  };

  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");
  assert.strictEqual(await client.findCollection("Daily Paper", null), "TARGET");
  assert.strictEqual(calls.length, 2);
  assert.match(calls[0], /collections\/top\?.*limit=100/);
  assert.match(calls[1], /collections\/top\?.*start=100/);
});

test("createPreprintItem adds exactly one PaperReader provenance marker", async () => {
  let payload;
  const fetchMock = async (_url, opts = {}) => {
    if (opts.method === "POST") {
      [payload] = JSON.parse(opts.body);
      return makeRes({ successful: { "0": { data: { key: "PARENT1" } } } });
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const key = await new win.ZoteroClient("KEY", "USER").createPreprintItem(
    {
      title: "Tagged paper",
      url: "https://arxiv.org/abs/2608.12345v1",
      authors: [],
      keywords: ["robotics", MANAGED_TAG, "  "],
    },
    "DATE"
  );
  assert.strictEqual(key, "PARENT1");
  assert.deepStrictEqual(payload.tags, [
    { tag: "robotics" },
    { tag: MANAGED_TAG },
  ]);
});

test("createLinkedFileAttachment sends linked_file path metadata only and returns its key", async () => {
  let request;
  const fetchMock = async (url, opts) => {
    request = { url: String(url), opts };
    return makeRes({ successful: { "0": { data: { key: "ATTACH1" } } } });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");
  const key = await client.createLinkedFileAttachment("PARENT1", {
    path: "attachments:2608.00001v1.pdf",
    title: "Paper PDF",
  });

  assert.strictEqual(key, "ATTACH1");
  assert.strictEqual(request.url, "https://api.zotero.org/users/USER/items");
  assert.strictEqual(request.opts.method, "POST");
  const token = request.opts.headers["Zotero-Write-Token"];
  assert.match(token, /^[0-9A-Za-z]{32}$/);
  const [payload] = JSON.parse(request.opts.body);
  assert.deepStrictEqual(payload, {
    itemType: "attachment",
    parentItem: "PARENT1",
    linkMode: "linked_file",
    title: "Paper PDF",
    path: "attachments:2608.00001v1.pdf",
    contentType: "application/pdf",
  });
  for (const forbidden of ["url", "filename", "md5", "mtime"]) {
    assert.strictEqual(Object.hasOwn(payload, forbidden), false, `${forbidden} must be omitted`);
  }
});

test("listChildAttachments paginates, filters attachments, and findLinkedFileAttachment matches path", async () => {
  const firstPage = Array.from({ length: 100 }, (_, i) => ({
    key: `A${i}`,
    data: {
      itemType: "attachment",
      linkMode: i === 0 ? "linked_file" : "linked_url",
      path: i === 0 ? "attachments:first.pdf" : undefined,
    },
  }));
  const secondPage = [
    {
      key: "MATCH",
      data: {
        itemType: "attachment",
        linkMode: "linked_file",
        path: "attachments:target.pdf",
      },
    },
    { key: "NOTE", data: { itemType: "note" } },
  ];
  const calls = [];
  const fetchMock = async (url) => {
    const u = String(url);
    calls.push(u);
    return makeRes(u.includes("start=100") ? secondPage : firstPage, { total: 102 });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");

  const items = await client.listChildAttachments("PARENT1");
  assert.strictEqual(items.length, 101);
  assert.strictEqual(items[100].key, "MATCH");
  assert.match(calls[0], /items\/PARENT1\/children\?.*itemType=attachment/);
  assert.match(calls[1], /items\/PARENT1\/children\?.*start=100/);

  calls.length = 0;
  const match = await client.findLinkedFileAttachment(
    "PARENT1",
    "attachments:target.pdf"
  );
  assert.strictEqual(match.key, "MATCH");
  const missing = await client.findLinkedFileAttachment(
    "PARENT1",
    "attachments:missing.pdf"
  );
  assert.strictEqual(missing, null);
});

test("POST network retry reuses one write token", async () => {
  const tokens = [];
  let calls = 0;
  const fetchMock = async (_url, opts) => {
    calls += 1;
    tokens.push(opts.headers["Zotero-Write-Token"]);
    if (calls === 1) throw new TypeError("network connection reset");
    return makeRes({ successful: { "0": { data: { key: "COLL1" } } } });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");

  assert.strictEqual(await client.createCollection("Daily Paper", null), "COLL1");
  assert.strictEqual(calls, 2);
  assert.match(tokens[0], /^[0-9A-Za-z]{32}$/);
  assert.strictEqual(tokens[1], tokens[0]);
});

test("every Zotero Web API attempt carries a bounded abort signal", async () => {
  let timeoutMs = null;
  const expectedSignal = { kind: "timeout" };
  const AbortSignal = {
    timeout(value) {
      timeoutMs = value;
      return expectedSignal;
    },
  };
  const fetchMock = async (_url, opts) => {
    assert.strictEqual(opts.signal, expectedSignal);
    const error = new Error("request aborted");
    error.name = "AbortError";
    throw error;
  };
  const win = loadZotero(fetchMock, { AbortSignal });
  await assert.rejects(new win.ZoteroClient("KEY", "USER").verify(), /request aborted/);
  assert.strictEqual(timeoutMs, 60 * 1000);
  assert.strictEqual(win.ZOTERO_REQUEST_TIMEOUT_MS, 60 * 1000);
});

test("HTTP 412 POST response is not retried", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    return makeRes("write token already used", { status: 412 });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");

  await assert.rejects(
    client.createCollection("Daily Paper", null),
    /Zotero POST .* → 412/
  );
  assert.strictEqual(calls, 1);
});

test("deleteItem recovers when a committed DELETE response is lost", async () => {
  let calls = 0;
  const fetchMock = async (_url, opts = {}) => {
    calls += 1;
    if (calls === 1) return makeRes({ version: 7 });
    if (opts.method === "DELETE") throw new TypeError("connection reset after commit");
    return makeRes("not found", { status: 404 });
  };
  const win = loadZotero(fetchMock);
  await new win.ZoteroClient("KEY", "USER").deleteItem("ABCDEFGH");
  assert.strictEqual(calls, 3);
});

test("deleteItem treats an already-missing item as the completed postcondition", async () => {
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    return makeRes("not found", { status: 404 });
  };
  const win = loadZotero(fetchMock);
  await new win.ZoteroClient("KEY", "USER").deleteItem("ABCDEFGH");
  assert.strictEqual(calls, 1);
});

test("getOrCreateCollection recovers a committed collection after a lost write response", async () => {
  let reads = 0;
  let posts = 0;
  const fetchMock = async (_url, opts = {}) => {
    if (opts.method === "POST") {
      posts += 1;
      return makeRes("write token already used", { status: 412 });
    }
    reads += 1;
    return makeRes(
      reads === 1
        ? []
        : [{ key: "COMMITTED", data: { key: "COMMITTED", name: "Daily Paper" } }],
      { total: reads === 1 ? 0 : 1 }
    );
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");

  assert.strictEqual(await client.getOrCreateCollection("Daily Paper"), "COMMITTED");
  assert.strictEqual(posts, 1);
  assert.strictEqual(reads, 2);
});

test("listDailyPaperArxivKeysMap preserves duplicate parent keys while the legacy map stays flat", async () => {
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("/collections/top")) {
      return makeRes([{ key: "ROOT", data: { key: "ROOT", name: "Daily Paper" } }], { total: 1 });
    }
    if (u.includes("/collections?")) {
      return makeRes(
        [
          { key: "ROOT", data: { name: "Daily Paper", parentCollection: false } },
          { key: "DATE", data: { name: "2026-08-11", parentCollection: "ROOT" } },
        ],
        { total: 2 }
      );
    }
    if (u.includes("/items?")) {
      return makeRes(
        [
          { key: "FIRST", data: { archiveID: "2608.12345v1", repository: "arXiv", collections: ["DATE"], tags: [{ tag: MANAGED_TAG }] } },
          { key: "SECOND", data: { archiveID: "2608.12345v2", repository: "arXiv", collections: ["DATE"], tags: [{ tag: MANAGED_TAG }] } },
          { key: "FIRST", data: { archiveID: "2608.12345v1", repository: "arXiv", collections: ["DATE"], tags: [{ tag: MANAGED_TAG }] } },
        ],
        { total: 3 }
      );
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");

  const all = await client.listDailyPaperArxivKeysMap("Daily Paper");
  assert.deepStrictEqual([...all["2608.12345"]], ["FIRST", "SECOND"]);
  const flat = await client.listDailyPaperArxivMap("Daily Paper");
  assert.strictEqual(flat["2608.12345"], "FIRST");
});

test("concurrent getOrCreateCollection calls share one find/create operation", async () => {
  let reads = 0;
  let posts = 0;
  let releaseRead;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const fetchMock = async (_url, opts = {}) => {
    if (opts.method === "POST") {
      posts += 1;
      return makeRes({ successful: { "0": { data: { key: "ONLY" } } } });
    }
    reads += 1;
    await readGate;
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");
  const a = client.getOrCreateCollection("Daily Paper");
  const b = client.getOrCreateCollection("Daily Paper");
  releaseRead();

  assert.deepStrictEqual(await Promise.all([a, b]), ["ONLY", "ONLY"]);
  assert.strictEqual(reads, 1);
  assert.strictEqual(posts, 1);
});

test("preprint creation recovers the committed key after network loss and write-token 412", async () => {
  let posts = 0;
  const fetchMock = async (url, opts = {}) => {
    if (opts.method === "POST") {
      posts += 1;
      if (posts === 1) throw new TypeError("connection reset after commit");
      return makeRes("write token already used", { status: 412 });
    }
    if (String(url).includes("/collections/DATE/items?")) {
      return makeRes(
        [{ key: "COMMITTED", data: { itemType: "preprint", archiveID: "2608.12345v1", repository: "arXiv", tags: [{ tag: MANAGED_TAG }] } }],
        { total: 1 }
      );
    }
    return makeRes([], { total: 0 });
  };
  const win = loadZotero(fetchMock);
  const client = new win.ZoteroClient("KEY", "USER");
  const key = await client.createPreprintItem(
    { url: "https://arxiv.org/abs/2608.12345v1", authors: [], keywords: [] },
    "DATE"
  );
  assert.strictEqual(key, "COMMITTED");
  assert.strictEqual(posts, 2);
});
