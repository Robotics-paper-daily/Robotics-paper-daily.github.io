const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RPC_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app-rpc.js"), "utf8");
const READ_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "read-paper.js"), "utf8");

function loadRpc(search = "?app=1&zotero=1") {
  const sent = [];
  const listeners = new Map();
  const timers = new Map();
  let timerId = 0;
  const parent = {
    postMessage(message, targetOrigin) {
      sent.push({ message, targetOrigin });
    },
  };
  const window = {
    location: { search, pathname: "/site/daily_html/2026_08_11.html" },
    parent,
    crypto: { randomUUID: (() => { let n = 0; return () => `uuid-${++n}`; })() },
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
  };
  const sandbox = {
    window,
    URLSearchParams,
    Date,
    Error,
    Promise,
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(RPC_SRC, sandbox, { filename: "app-rpc.js" });
  return {
    bridge: window.PaperReaderReportBridge,
    sent,
    parent,
    timers,
    dispatch(source, data) {
      listeners.get("message")({ source, data });
    },
  };
}

test("report RPC advertises frozen app capabilities with a ready event", () => {
  const rpc = loadRpc();
  assert.strictEqual(Object.isFrozen(rpc.bridge), true);
  assert.strictEqual(Object.isFrozen(rpc.bridge.zotero), true);
  assert.strictEqual(rpc.bridge.appEnabled, true);
  assert.strictEqual(rpc.bridge.zoteroEnabled, true);
  assert.strictEqual(rpc.bridge.zotero.isUnlocked(), true);
  assert.strictEqual(
    rpc.bridge.zotero.listDailyPaperArxivMap,
    rpc.bridge.zoteroList
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rpc.sent[0])), {
    targetOrigin: "*",
    message: {
      channel: "paperreader-report-v1",
      type: "event",
      event: "ready",
      payload: { app: true, zoteroEnabled: true },
    },
  });
});

test("request ids are unique and only a direct-parent response can resolve them", async () => {
  const rpc = loadRpc();
  const first = rpc.bridge.read({ title: "A" });
  const second = rpc.bridge.listJobs();
  const requests = rpc.sent.slice(1).map((entry) => entry.message);

  assert.strictEqual(requests[0].method, "paper:read");
  assert.deepStrictEqual(requests[0].payload, { title: "A" });
  assert.strictEqual(requests[1].method, "job:list");
  assert.notStrictEqual(requests[0].id, requests[1].id);

  let firstSettled = false;
  first.then(() => { firstSettled = true; });
  rpc.dispatch({}, {
    channel: "paperreader-report-v1",
    type: "response",
    id: requests[0].id,
    ok: true,
    result: { ok: true, jobId: "wrong-source" },
  });
  await Promise.resolve();
  assert.strictEqual(firstSettled, false);

  rpc.dispatch(rpc.parent, {
    channel: "paperreader-report-v1",
    type: "response",
    id: requests[0].id,
    ok: true,
    result: { ok: true, jobId: "J1" },
  });
  rpc.dispatch(rpc.parent, {
    channel: "paperreader-report-v1",
    type: "response",
    id: requests[1].id,
    ok: true,
    result: [],
  });
  assert.deepStrictEqual(await first, { ok: true, jobId: "J1" });
  assert.deepStrictEqual(await second, []);
});

test("progress events are source-filtered and subscriptions can be removed", () => {
  const rpc = loadRpc();
  const events = [];
  const off = rpc.bridge.onProgress((event) => events.push(event));
  const message = {
    channel: "paperreader-report-v1",
    type: "event",
    event: "progress",
    payload: { jobId: "J1", state: "running" },
  };

  rpc.dispatch({}, message);
  rpc.dispatch(rpc.parent, { ...message, channel: "another-channel" });
  assert.deepStrictEqual(events, []);
  rpc.dispatch(rpc.parent, message);
  assert.deepStrictEqual(events, [{ jobId: "J1", state: "running" }]);
  off();
  rpc.dispatch(rpc.parent, message);
  assert.strictEqual(events.length, 1);
});

test("confirmed mutations have no renderer timeout and Zotero wrappers stay report-scoped", async () => {
  const rpc = loadRpc();
  const pending = rpc.bridge.zoteroAdd({ title: "Paper" });
  const request = rpc.sent.at(-1).message;
  assert.strictEqual(request.method, "zotero:add");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(request.payload)), {
    paper: { title: "Paper" },
    reportFile: "2026_08_11.html",
  });
  assert.strictEqual(rpc.timers.size, 0);

  rpc.bridge.zoteroRemove("opaque-ref").catch(() => {});
  assert.deepStrictEqual({ ...rpc.sent.at(-1).message.payload }, {
    itemRef: "opaque-ref",
    reportFile: "2026_08_11.html",
  });
  assert.strictEqual(rpc.sent.at(-1).message.method, "zotero:remove");

  rpc.bridge.zoteroList(["2608.01234"]).catch(() => {});
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rpc.sent.at(-1).message.payload)), {
    baseIds: ["2608.01234"],
    reportFile: "2026_08_11.html",
  });
  assert.strictEqual(rpc.timers.size, 0);

  const requestId = request.id;
  rpc.dispatch(rpc.parent, {
    channel: "paperreader-report-v1",
    type: "response",
    id: requestId,
    ok: true,
    result: { ok: true, itemKey: "opaque-ref" },
  });
  assert.deepStrictEqual(await pending, { ok: true, itemKey: "opaque-ref" });

  const timed = rpc.bridge.listJobs();
  const timer = [...rpc.timers.values()].at(-1);
  assert.strictEqual(timer.delay, 30 * 1000);
  timer.callback();
  await assert.rejects(timed, (error) => error.code === "RPC_TIMEOUT");
});

test("read-paper enables app mode through report RPC without touching window.top", () => {
  const added = [];
  const noop = () => {};
  const window = {
    PaperReaderReportBridge: { appEnabled: true, onProgress: noop },
    location: { pathname: "/daily_html/2026_08_11.html" },
  };
  Object.defineProperty(window, "top", {
    get() {
      throw new Error("window.top must not be read");
    },
  });
  const sandbox = {
    window,
    location: window.location,
    document: {
      readyState: "loading",
      addEventListener: noop,
      getElementById: () => null,
      body: { classList: { add: (name) => added.push(name) } },
    },
    console,
  };
  vm.createContext(sandbox);
  assert.doesNotThrow(() => vm.runInContext(READ_SRC, sandbox, { filename: "read-paper.js" }));
  assert.deepStrictEqual(added, ["app-mode"]);
});

test("read-paper dynamic states use local SVG icons and a local spinner animation", () => {
  for (const name of ["wand", "queued", "running", "done", "book", "error", "checked", "unchecked", "check"]) {
    assert.match(READ_SRC, new RegExp(`readSvg\\(\\s*"${name}"`), name);
  }
  assert.match(READ_SRC, /data-read-icon=/);
  assert.match(READ_SRC, /@keyframes read-icon-spin/);
  assert.match(READ_SRC, /read-svg-icon-spin/);
  assert.doesNotMatch(READ_SRC, /<i\b|\b(?:fas|far|fab|fa-[a-z0-9-]+)\b/i);
});
