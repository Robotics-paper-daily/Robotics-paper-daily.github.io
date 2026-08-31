const test = require("node:test");
const assert = require("node:assert");

const {
  ZoteroPdfQueue,
  DEFAULT_ZOTERO_PDF_CONCURRENCY,
} = require("../app/zotero-pdf-queue");

const turn = () => new Promise((resolve) => setImmediate(resolve));

function deferredTask(id, started, releases) {
  return () =>
    new Promise((resolve) => {
      started.push(id);
      releases.set(id, () => resolve(id));
    });
}

test("Zotero PDF queue runs four writes and keeps later papers FIFO queued", async () => {
  assert.strictEqual(DEFAULT_ZOTERO_PDF_CONCURRENCY, 4);
  const queue = new ZoteroPdfQueue();
  const started = [];
  const releases = new Map();
  const operations = Array.from({ length: 7 }, (_, index) => {
    const id = `paper-${index + 1}`;
    return queue.enqueue(id, deferredTask(id, started, releases));
  });

  await turn();
  assert.deepStrictEqual(started, ["paper-1", "paper-2", "paper-3", "paper-4"]);
  assert.deepStrictEqual(queue.snapshot(), {
    concurrency: 4,
    active: 4,
    pending: 3,
    inFlight: 7,
  });

  releases.get("paper-2")();
  await turn();
  assert.deepStrictEqual(started, ["paper-1", "paper-2", "paper-3", "paper-4", "paper-5"]);

  for (const id of ["paper-1", "paper-3", "paper-4", "paper-5"]) releases.get(id)();
  await turn();
  assert.deepStrictEqual(started, [
    "paper-1",
    "paper-2",
    "paper-3",
    "paper-4",
    "paper-5",
    "paper-6",
    "paper-7",
  ]);
  releases.get("paper-6")();
  releases.get("paper-7")();

  assert.deepStrictEqual(await Promise.all(operations), [
    "paper-1",
    "paper-2",
    "paper-3",
    "paper-4",
    "paper-5",
    "paper-6",
    "paper-7",
  ]);
  assert.deepStrictEqual(queue.snapshot(), {
    concurrency: 4,
    active: 0,
    pending: 0,
    inFlight: 0,
  });
});

test("Zotero PDF queue supports five active writes when configured", async () => {
  const queue = new ZoteroPdfQueue(5);
  const started = [];
  const releases = new Map();
  const operations = Array.from({ length: 6 }, (_, index) => {
    const id = `paper-${index + 1}`;
    return queue.enqueue(id, deferredTask(id, started, releases));
  });

  await turn();
  assert.deepStrictEqual(started, ["paper-1", "paper-2", "paper-3", "paper-4", "paper-5"]);
  assert.strictEqual(queue.snapshot().pending, 1);

  releases.get("paper-1")();
  await turn();
  assert.strictEqual(started.at(-1), "paper-6");
  for (const id of ["paper-2", "paper-3", "paper-4", "paper-5", "paper-6"]) releases.get(id)();
  await Promise.all(operations);
});

test("Zotero PDF queue accepts a twelve-paper burst without exceeding four active writes", async () => {
  const queue = new ZoteroPdfQueue();
  let active = 0;
  let peak = 0;
  const completed = [];

  const operations = Array.from({ length: 12 }, (_, index) => {
    const id = index + 1;
    return queue.enqueue(`paper-${id}`, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await turn();
      completed.push(id);
      active -= 1;
      return id;
    });
  });

  assert.deepStrictEqual(await Promise.all(operations), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepStrictEqual(completed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.strictEqual(peak, 4);
});

test("Zotero PDF queue coalesces the same paper while queued or running", async () => {
  const queue = new ZoteroPdfQueue(1);
  const started = [];
  const releases = new Map();
  const first = queue.enqueue("first", deferredTask("first", started, releases));
  const duplicateA = queue.enqueue("same-paper", deferredTask("same-a", started, releases));
  const duplicateB = queue.enqueue("same-paper", deferredTask("same-b", started, releases));

  assert.strictEqual(duplicateB, duplicateA);
  await turn();
  assert.deepStrictEqual(started, ["first"]);
  releases.get("first")();
  await turn();
  assert.deepStrictEqual(started, ["first", "same-a"]);
  assert.strictEqual(started.includes("same-b"), false);
  releases.get("same-a")();
  assert.deepStrictEqual(await Promise.all([first, duplicateA, duplicateB]), [
    "first",
    "same-a",
    "same-a",
  ]);
});

test("Zotero PDF queue releases a slot after a task fails", async () => {
  const queue = new ZoteroPdfQueue(1);
  const failed = queue.enqueue("bad", async () => {
    throw new Error("download failed");
  });
  const next = queue.enqueue("next", async () => "ok");

  await assert.rejects(failed, /download failed/);
  assert.strictEqual(await next, "ok");
  assert.strictEqual(queue.snapshot().active, 0);
});

test("Zotero PDF queue preserves an undefined rejection", async () => {
  const queue = new ZoteroPdfQueue(1);
  const failed = queue.enqueue("bad", () => Promise.reject());
  const next = queue.enqueue("next", async () => "ok");

  await assert.rejects(failed, () => true);
  assert.strictEqual(await next, "ok");
});

test("Zotero PDF queue rejects invalid concurrency", () => {
  for (const value of [0, -1, 1.5, NaN]) {
    assert.throws(() => new ZoteroPdfQueue(value), /positive integer/);
  }
});
