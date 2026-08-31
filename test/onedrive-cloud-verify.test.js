"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  OneDriveCloudVerifyError,
  verifyOneDriveCloudFile,
} = require("../app/onedrive-cloud-verify");

function tempFile(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-onedrive-verify-"));
  const file = path.join(root, "paper.pdf");
  fs.writeFileSync(file, "%PDF-test");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file };
}

function evaluation(overrides = {}) {
  const values = {
    isUploaded: 1,
    isUploading: 0,
    isExcludedFromSync: 0,
    isSyncPaused: 0,
    hasUnresolvedConflicts: 0,
    ...overrides,
  };
  return Object.entries(values).map(([key, value]) => `${key} = ${value};`).join("\n");
}

function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    delay: async (ms) => { time += ms; },
  };
}

function hasCode(code) {
  return (error) => error instanceof OneDriveCloudVerifyError && error.code === code;
}

test("immediately confirms a fully uploaded conflict-free file", async (t) => {
  const { file } = tempFile(t);
  let calls = 0;
  const result = await verifyOneDriveCloudFile(file, {
    platform: "darwin",
    execFileImpl: async (command, args) => {
      calls++;
      assert.strictEqual(command, "/usr/bin/fileproviderctl");
      assert.deepStrictEqual(args, ["evaluate", file]);
      return { stdout: evaluation() };
    },
  });

  assert.deepStrictEqual(result, { confirmed: true });
  assert.strictEqual(calls, 1);
  assert.strictEqual(Object.hasOwn(result, "output"), false);
});

test("passes a bounded timeout to each fileproviderctl process", async (t) => {
  const { file } = tempFile(t);
  let observedTimeout = null;
  await verifyOneDriveCloudFile(file, {
    platform: "darwin",
    commandTimeoutMs: 4321,
    execFileImpl: (_command, _args, options, callback) => {
      observedTimeout = options.timeout;
      callback(null, evaluation());
    },
  });
  assert.strictEqual(observedTimeout, 4321);
});

test("polls while uploading and succeeds after all flags become safe", async (t) => {
  const { file } = tempFile(t);
  const clock = fakeClock();
  let calls = 0;
  const result = await verifyOneDriveCloudFile(file, {
    platform: "darwin",
    timeoutMs: 20,
    pollIntervalMs: 5,
    now: clock.now,
    delay: clock.delay,
    execFileImpl: async () => ({
      stdout: ++calls === 1
        ? evaluation({ isUploaded: 0, isUploading: 1 })
        : evaluation(),
    }),
  });

  assert.deepStrictEqual(result, { confirmed: true });
  assert.strictEqual(calls, 2);
});

test("never accepts an unresolved conflict and eventually times out", async (t) => {
  const { file } = tempFile(t);
  const clock = fakeClock();
  let calls = 0;

  await assert.rejects(
    verifyOneDriveCloudFile(file, {
      platform: "darwin",
      timeoutMs: 11,
      pollIntervalMs: 5,
      now: clock.now,
      delay: clock.delay,
      execFileImpl: async () => {
        calls++;
        return { stdout: evaluation({ hasUnresolvedConflicts: 1 }) };
      },
    }),
    hasCode("CONFIRMATION_TIMEOUT")
  );
  assert.strictEqual(calls, 3);
});

test("retries command errors and can recover", async (t) => {
  const { file } = tempFile(t);
  const clock = fakeClock();
  let calls = 0;

  const result = await verifyOneDriveCloudFile(file, {
    platform: "darwin",
    timeoutMs: 20,
    pollIntervalMs: 5,
    now: clock.now,
    delay: clock.delay,
    execFileImpl: async () => {
      calls++;
      if (calls < 3) throw new Error("temporary command failure");
      return { stdout: evaluation() };
    },
  });

  assert.deepStrictEqual(result, { confirmed: true });
  assert.strictEqual(calls, 3);
});

test("persistent command errors end with a stable command-failure code", async (t) => {
  const { file } = tempFile(t);
  const clock = fakeClock();
  let calls = 0;

  await assert.rejects(
    verifyOneDriveCloudFile(file, {
      platform: "darwin",
      timeoutMs: 10,
      pollIntervalMs: 5,
      now: clock.now,
      delay: clock.delay,
      execFileImpl: async () => {
        calls++;
        throw new Error("still unavailable");
      },
    }),
    hasCode("FILE_PROVIDER_COMMAND_FAILED")
  );
  assert.strictEqual(calls, 2);
});

test("an abort during polling stops before another command", async (t) => {
  const { file } = tempFile(t);
  const controller = new AbortController();
  let calls = 0;

  await assert.rejects(
    verifyOneDriveCloudFile(file, {
      platform: "darwin",
      timeoutMs: 100,
      signal: controller.signal,
      execFileImpl: async () => {
        calls++;
        return { stdout: evaluation({ isUploaded: 0, isUploading: 1 }) };
      },
      delay: async () => { controller.abort(); },
    }),
    hasCode("ABORTED")
  );
  assert.strictEqual(calls, 1);
});

test("rejects a symlink without running fileproviderctl", async (t) => {
  const { root, file } = tempFile(t);
  const link = path.join(root, "paper-link.pdf");
  fs.symlinkSync(file, link);
  let called = false;

  await assert.rejects(
    verifyOneDriveCloudFile(link, {
      platform: "darwin",
      execFileImpl: async () => {
        called = true;
        return { stdout: evaluation() };
      },
    }),
    hasCode("SYMLINK_NOT_ALLOWED")
  );
  assert.strictEqual(called, false);
});

test("returns unsupported on non-macOS without touching the path or command", async () => {
  let called = false;
  const result = await verifyOneDriveCloudFile("relative/missing.pdf", {
    platform: "linux",
    execFileImpl: async () => {
      called = true;
      return { stdout: evaluation() };
    },
  });

  assert.deepStrictEqual(result, { confirmed: false, reason: "unsupported-platform" });
  assert.strictEqual(called, false);
});
