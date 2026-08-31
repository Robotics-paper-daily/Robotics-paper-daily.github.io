const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "app", "zotero-save.js"), "utf8");

function extractArxivId(url) {
  const match = String(url || "").match(/arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:\.pdf)?$/i);
  return match ? match[1] : null;
}

function loadModule() {
  const sandbox = {
    window: {},
    extractArxivId,
    baseArxivId: (id) => (id ? String(id).replace(/v\d+$/i, "") : null),
    ZoteroClient: function ZoteroClient() {},
    Date,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "zotero-save.js" });
  return sandbox.window.ZoteroSave;
}

function linkedItem(key, parentItem, zoteroPath) {
  return {
    key,
    data: {
      key,
      itemType: "attachment",
      parentItem,
      linkMode: "linked_file",
      contentType: "application/pdf",
      path: zoteroPath,
    },
  };
}

function fixture({ added = {}, children = {}, inventory = null } = {}) {
  const calls = [];
  const childMap = new Map(Object.entries(children));
  const client = {
    async listDailyPaperArxivMap() {
      calls.push(["map"]);
      return { ...added };
    },
    async getOrCreateCollection(name, parent) {
      calls.push(["collection", name, parent]);
      return parent ? "DATE" : "ROOT";
    },
    async createPreprintItem(paper, collection) {
      calls.push(["parent", paper.url, collection]);
      return "NEWPARENT";
    },
    async listChildAttachments(parent) {
      calls.push(["children", parent]);
      return childMap.get(parent) || [];
    },
    async findLinkedFileAttachment(parent, zoteroPath) {
      calls.push(["find", parent, zoteroPath]);
      return (
        (childMap.get(parent) || []).find(
          (item) =>
            item.data.linkMode === "linked_file" &&
            (zoteroPath == null || item.data.path === zoteroPath)
        ) || null
      );
    },
    async createLinkedFileAttachment(parent, meta) {
      calls.push(["attachment", parent, meta.path]);
      const item = linkedItem("NEWATTACH", parent, meta.path);
      childMap.set(parent, [...(childMap.get(parent) || []), item]);
      return item.key;
    },
    async deleteItem(key) {
      calls.push(["delete", key]);
    },
  };
  if (inventory) {
    client.listLibraryArxivInventory = async () => {
      calls.push(["inventory"]);
      return inventory;
    };
  }
  let writes = 0;
  const bridge = {
    async zoteroWriteLinkedPdf({ sourceUrl }) {
      writes += 1;
      calls.push(["write", sourceUrl]);
      const id = extractArxivId(sourceUrl).replace("/", "_");
      return {
        ok: true,
        state: "stored",
        filename: `${id}.pdf`,
        zoteroPath: `attachments:${id}.pdf`,
        bytes: 1234,
        sha256: "a".repeat(64),
        cloudConfirmed: true,
      };
    },
  };
  return { client, bridge, calls, get writes() { return writes; } };
}

const PAPER = {
  title: "Paper",
  summary: "Summary",
  url: "http://arxiv.org/abs/2608.12345v1",
  authors: ["A"],
  keywords: [],
  date: "2026-08-11",
};

test("Saver coalesces concurrent adds and creates one linked-file flow", async () => {
  const { Saver } = loadModule();
  const f = fixture();
  const saver = new Saver(f.client, f.bridge);
  const [a, b, c] = await Promise.all([saver.add(PAPER), saver.add(PAPER), saver.add(PAPER)]);

  assert.strictEqual(a.status, "complete");
  assert.strictEqual(b.itemKey, a.itemKey);
  assert.strictEqual(c.itemKey, a.itemKey);
  assert.strictEqual(f.writes, 1);
  assert.strictEqual(f.calls.filter((call) => call[0] === "parent").length, 1);
  assert.strictEqual(f.calls.filter((call) => call[0] === "attachment").length, 1);
  assert.strictEqual(a.pdf.zoteroPath, "attachments:2608.12345v1.pdf");
});

test("Saver returns already-added without touching disk when a linked PDF exists", async () => {
  const { Saver } = loadModule();
  const existing = linkedItem("OLDATTACH", "OLDPARENT", "attachments:2608.12345v1.pdf");
  const f = fixture({
    added: { "2608.12345": "OLDPARENT" },
    children: { OLDPARENT: [existing] },
  });
  const result = await new Saver(f.client, f.bridge).add(PAPER);

  assert.strictEqual(result.status, "already-added");
  assert.strictEqual(result.itemKey, "OLDPARENT");
  assert.strictEqual(result.pdf.attachmentKey, "OLDATTACH");
  assert.strictEqual(f.writes, 0);
  assert.strictEqual(f.calls.some((call) => call[0] === "parent"), false);
});

test("Saver reuses its added-map cache when sandbox pages reconcile", async () => {
  const { Saver } = loadModule();
  const f = fixture({ added: { "2608.12345": "OLDPARENT" } });
  const saver = new Saver(f.client, f.bridge);

  assert.deepStrictEqual(JSON.parse(JSON.stringify(await saver.listAddedMap("Daily Paper"))), {
    "2608.12345": { state: "managed", itemKey: "OLDPARENT" },
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await saver.listAddedMap("Daily Paper"))), {
    "2608.12345": { state: "managed", itemKey: "OLDPARENT" },
  });
  assert.strictEqual(f.calls.filter((call) => call[0] === "map").length, 1);
});

test("Saver repairs a pre-existing parent that has no linked file", async () => {
  const { Saver } = loadModule();
  const f = fixture({ added: { "2608.12345": "OLDPARENT" } });
  const result = await new Saver(f.client, f.bridge).add(PAPER);

  assert.strictEqual(result.status, "repaired");
  assert.strictEqual(result.itemKey, "OLDPARENT");
  assert.strictEqual(f.writes, 1);
  assert.strictEqual(f.calls.some((call) => call[0] === "parent"), false);
  assert.strictEqual(f.calls.filter((call) => call[0] === "attachment").length, 1);
});

test("Saver checks every duplicate parent and uses the one that already has a linked PDF", async () => {
  const { Saver } = loadModule();
  const complete = linkedItem("ATTACH2", "PARENT2", "attachments:2608.12345v1.pdf");
  const f = fixture({ children: { PARENT1: [], PARENT2: [complete] } });
  f.client.listDailyPaperArxivKeysMap = async () => ({
    "2608.12345": ["PARENT1", "PARENT2"],
  });

  const result = await new Saver(f.client, f.bridge).add(PAPER);
  assert.strictEqual(result.status, "already-added");
  assert.strictEqual(result.itemKey, "PARENT2");
  assert.strictEqual(f.writes, 0);
  assert.strictEqual(f.calls.some((call) => call[0] === "attachment"), false);
});

test("Saver refuses metadata creation when the privileged file write fails", async () => {
  const { Saver } = loadModule();
  const f = fixture();
  f.bridge.zoteroWriteLinkedPdf = async () => ({
    ok: false,
    code: "INVALID_ROOT",
    reason: "未配置 Zotero 链接附件基准目录",
  });

  await assert.rejects(new Saver(f.client, f.bridge).add(PAPER), /未配置 Zotero/);
  assert.strictEqual(f.calls.some((call) => call[0] === "parent"), false);
  assert.strictEqual(f.calls.some((call) => call[0] === "attachment"), false);
});

test("Saver recovers a parent committed before its write response was lost", async () => {
  const { Saver } = loadModule();
  const f = fixture();
  let mapReads = 0;
  f.client.listDailyPaperArxivMap = async () => {
    mapReads += 1;
    return mapReads === 1 ? {} : { "2608.12345": "COMMITTEDPARENT" };
  };
  f.client.createPreprintItem = async () => {
    throw new Error("Zotero POST /items → 412");
  };

  const result = await new Saver(f.client, f.bridge).add(PAPER);
  assert.strictEqual(result.status, "repaired");
  assert.strictEqual(result.itemKey, "COMMITTEDPARENT");
  assert.strictEqual(mapReads, 2);
  assert.strictEqual(
    f.calls.filter((call) => call[0] === "attachment" && call[1] === "COMMITTEDPARENT").length,
    1
  );
});

test("Saver remove deletes Zotero metadata but explicitly preserves linked bytes", async () => {
  const { Saver } = loadModule();
  const f = fixture({ added: { "2608.12345": "PARENT" } });
  const result = await new Saver(f.client, f.bridge).remove("PARENT");
  assert.deepStrictEqual(
    { ...result },
    {
      ok: true,
      linkedFilePreserved: true,
      remainingItemKey: null,
      remainingDuplicates: 0,
      libraryMatchRemaining: false,
    }
  );
  assert.deepStrictEqual(f.calls.filter((call) => call[0] === "delete"), [["delete", "PARENT"]]);
});

test("Saver remove reports but does not bulk-delete duplicate parents", async () => {
  const { Saver } = loadModule();
  const f = fixture();
  f.client.listDailyPaperArxivKeysMap = async () => ({
    "2608.12345": ["PARENT1", "PARENT2", "PARENT3"],
  });
  const result = await new Saver(f.client, f.bridge).remove("PARENT2");

  assert.strictEqual(result.remainingItemKey, "PARENT1");
  assert.strictEqual(result.remainingDuplicates, 2);
  assert.deepStrictEqual(f.calls.filter((call) => call[0] === "delete"), [["delete", "PARENT2"]]);
});

test("Saver refuses to delete an arbitrary item outside the Daily Paper tree", async () => {
  const { Saver } = loadModule();
  const f = fixture({ added: { "2608.12345": "KNOWN" } });
  await assert.rejects(new Saver(f.client, f.bridge).remove("ARBITRARY"), /拒绝删除/);
  assert.strictEqual(f.calls.some((call) => call[0] === "delete"), false);
});

test("Saver binds an existing item anywhere in the library without writing or granting removal", async () => {
  const { Saver } = loadModule();
  const f = fixture({
    inventory: {
      "2608.12345": { libraryKeys: ["EXTERNAL"], managedKeys: [] },
    },
  });
  const saver = new Saver(f.client, f.bridge);

  assert.deepStrictEqual(JSON.parse(JSON.stringify(await saver.listAddedMap("Daily Paper"))), {
    "2608.12345": { state: "existing" },
  });
  const result = await saver.add(PAPER);
  assert.strictEqual(result.status, "already-in-library");
  assert.strictEqual(result.managed, false);
  assert.strictEqual(result.itemKey, "EXTERNAL");
  assert.strictEqual(f.writes, 0);
  assert.strictEqual(f.calls.some((call) => call[0] === "parent"), false);
  assert.strictEqual(
    f.calls.filter((call) => call[0] === "inventory").length,
    2,
    "a mutation must refresh when the test client has no library version"
  );
  await assert.rejects(saver.remove("EXTERNAL"), /拒绝删除/);
  assert.strictEqual(f.calls.some((call) => call[0] === "delete"), false);
});

test("removing an App-managed duplicate preserves a read-only library match", async () => {
  const { Saver } = loadModule();
  const f = fixture({
    inventory: {
      "2608.12345": {
        libraryKeys: ["MANAGED", "EXTERNAL"],
        managedKeys: ["MANAGED"],
      },
    },
  });
  const saver = new Saver(f.client, f.bridge);
  const result = await saver.remove("MANAGED");

  assert.strictEqual(result.libraryMatchRemaining, true);
  assert.strictEqual(result.remainingItemKey, null);
  assert.deepStrictEqual(f.calls.filter((call) => call[0] === "delete"), [["delete", "MANAGED"]]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await saver.listAddedMap("Daily Paper"))), {
    "2608.12345": { state: "existing" },
  });
});

test("Saver revalidates a changed library version before Add and avoids a stale duplicate", async () => {
  const { Saver } = loadModule();
  const f = fixture({ inventory: {} });
  let version = 1;
  let scans = 0;
  f.client.listLibraryArxivInventory = async () => {
    scans += 1;
    f.client.lastLibraryInventoryVersion = version;
    return version === 1
      ? {}
      : { "2608.12345": { libraryKeys: ["EXTERNAL"], managedKeys: [] } };
  };
  f.client.getLibraryVersion = async () => version;
  const saver = new Saver(f.client, f.bridge);

  await saver.listAddedMap("Daily Paper");
  version = 2; // the user added the paper directly in Zotero after reconciliation
  const result = await saver.add(PAPER);

  assert.strictEqual(result.status, "already-in-library");
  assert.strictEqual(scans, 2);
  assert.strictEqual(f.writes, 0);
  assert.strictEqual(f.calls.some((call) => call[0] === "parent"), false);
});

test("Saver refreshes after its own write invalidates the cached library version", async () => {
  const { Saver } = loadModule();
  const f = fixture({ inventory: {} });
  let version = 1;
  let secondPaperExists = false;
  let scans = 0;
  f.client.listLibraryArxivInventory = async () => {
    scans += 1;
    f.client.lastLibraryInventoryVersion = version;
    return secondPaperExists
      ? { "2608.54321": { libraryKeys: ["EXTERNAL"], managedKeys: [] } }
      : {};
  };
  f.client.getLibraryVersion = async () => version;
  const saver = new Saver(f.client, f.bridge);

  const first = await saver.add(PAPER);
  assert.strictEqual(first.status, "complete");
  secondPaperExists = true;
  version = 2;

  const second = await saver.add({
    ...PAPER,
    title: "Second paper",
    url: "https://arxiv.org/abs/2608.54321v1",
  });
  assert.strictEqual(second.status, "already-in-library");
  assert.strictEqual(second.itemKey, "EXTERNAL");
  assert.strictEqual(f.writes, 1, "the external paper must not be downloaded again");
  assert.strictEqual(f.calls.filter((call) => call[0] === "parent").length, 1);
  assert.ok(scans >= 3, "the null post-write version must trigger a fresh scan");
});

test("Saver revalidates after the deferred OneDrive write before creating Zotero metadata", async () => {
  const { Saver } = loadModule();
  const f = fixture({ inventory: {} });
  let version = 1;
  let externalExists = false;
  let releaseWrite;
  let markWriteStarted;
  const writeStarted = new Promise((resolve) => {
    markWriteStarted = resolve;
  });
  const writeGate = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  f.client.listLibraryArxivInventory = async () => {
    f.client.lastLibraryInventoryVersion = version;
    return externalExists
      ? { "2608.12345": { libraryKeys: ["EXTERNAL"], managedKeys: [] } }
      : {};
  };
  f.client.getLibraryVersion = async () => version;
  f.bridge.zoteroWriteLinkedPdf = async () => {
    markWriteStarted();
    await writeGate;
    return {
      ok: true,
      state: "stored",
      filename: "2608.12345v1.pdf",
      zoteroPath: "attachments:2608.12345v1.pdf",
      bytes: 1234,
      sha256: "a".repeat(64),
      cloudConfirmed: true,
    };
  };
  const saver = new Saver(f.client, f.bridge);

  const pending = saver.add(PAPER);
  await writeStarted;
  externalExists = true;
  version = 2;
  releaseWrite();
  const result = await pending;

  assert.strictEqual(result.status, "already-in-library");
  assert.strictEqual(result.itemKey, "EXTERNAL");
  assert.strictEqual(f.calls.some((call) => call[0] === "parent"), false);
  assert.strictEqual(f.calls.some((call) => call[0] === "attachment"), false);
});

test("Saver revalidates managed membership immediately before delete", async () => {
  const { Saver } = loadModule();
  const f = fixture({
    inventory: {
      "2608.12345": { libraryKeys: ["MANAGED"], managedKeys: ["MANAGED"] },
    },
  });
  f.client.lastLibraryInventoryVersion = 7;
  f.client.getLibraryVersion = async () => 7;
  f.client.isItemManagedInCollectionTree = async () => false;

  await assert.rejects(new Saver(f.client, f.bridge).remove("MANAGED"), /已移出/);
  assert.strictEqual(f.calls.some((call) => call[0] === "delete"), false);
});

test("Saver refuses an old report reference after the item's arXiv identity changes", async () => {
  const { Saver } = loadModule();
  const f = fixture({
    inventory: {
      "2608.99999": { libraryKeys: ["MANAGED"], managedKeys: ["MANAGED"] },
    },
  });
  f.client.lastLibraryInventoryVersion = 9;
  f.client.getLibraryVersion = async () => 9;
  f.client.isItemManagedInCollectionTree = async () => true;

  await assert.rejects(
    new Saver(f.client, f.bridge).remove("MANAGED", "2608.12345"),
    /身份已变化/
  );
  assert.strictEqual(f.calls.some((call) => call[0] === "delete"), false);
});
