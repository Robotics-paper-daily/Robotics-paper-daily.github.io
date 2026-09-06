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
  try {
    fs.symlinkSync(file, link);
  } catch (error) {
    // Windows without Developer Mode/admin cannot create symlinks (EPERM);
    // the production check still applies wherever links can exist.
    if (error && error.code === "EPERM") {
      t.skip("symlink creation requires elevated privileges here");
      return;
    }
    throw error;
  }
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

test("returns unsupported on platforms without a cloud adapter", async () => {
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

// ----- Windows cloud-files adapter -----

const {
  WIN_ATTR_REPARSE_POINT,
  WIN_ATTR_OFFLINE,
  WIN_ATTR_RECALL_ON_DATA_ACCESS,
  isConfirmedWindowsAttributes,
  windowsAttributeCommand,
} = require("../app/onedrive-cloud-verify");

const WIN_ATTR_ARCHIVE = 0x20;

test("windows attribute parsing confirms only cloud placeholders", () => {
  // Plain local file (Archive only): still uploading or unsynced.
  assert.strictEqual(isConfirmedWindowsAttributes(String(WIN_ATTR_ARCHIVE)), false);
  // In-sync hydrated placeholder.
  assert.strictEqual(
    isConfirmedWindowsAttributes(`${WIN_ATTR_ARCHIVE | WIN_ATTR_REPARSE_POINT}\r\n`),
    true
  );
  // Dehydrated cloud-only placeholder is uploaded by definition.
  assert.strictEqual(
    isConfirmedWindowsAttributes(
      String(
        WIN_ATTR_ARCHIVE |
          WIN_ATTR_REPARSE_POINT |
          WIN_ATTR_OFFLINE |
          WIN_ATTR_RECALL_ON_DATA_ACCESS
      )
    ),
    true
  );
  // Garbage, empty, and negative reports never confirm.
  assert.strictEqual(isConfirmedWindowsAttributes(""), false);
  assert.strictEqual(isConfirmedWindowsAttributes("Get-Item : not found"), false);
  assert.strictEqual(isConfirmedWindowsAttributes("-1"), false);
});

test("windows attribute command quotes the path as a PowerShell literal", () => {
  const invocation = windowsAttributeCommand("C:\\OneDrive\\Zotero's papers\\2608.01201v1.pdf");
  assert.strictEqual(invocation.command, "powershell.exe");
  assert.ok(invocation.args.includes("-NoProfile"));
  assert.ok(invocation.args.includes("-NonInteractive"));
  const script = invocation.args[invocation.args.length - 1];
  assert.match(script, /Get-Item -LiteralPath 'C:\\OneDrive\\Zotero''s papers\\2608\.01201v1\.pdf' -Force/);
  assert.throws(
    () => windowsAttributeCommand("C:\\OneDrive\\bad\npath.pdf"),
    (error) => error instanceof OneDriveCloudVerifyError && error.code === "INVALID_PATH"
  );
});

test("windows verification polls attributes until the placeholder appears", async (t) => {
  const { file } = tempFile(t);
  const clock = fakeClock();
  let calls = 0;
  const result = await verifyOneDriveCloudFile(file, {
    platform: "win32",
    timeoutMs: 30,
    pollIntervalMs: 5,
    now: clock.now,
    delay: clock.delay,
    execFileImpl: async (command, args) => {
      calls++;
      assert.strictEqual(command, "powershell.exe");
      assert.ok(args[args.length - 1].includes("-LiteralPath"));
      return {
        stdout:
          calls < 3
            ? String(WIN_ATTR_ARCHIVE)
            : String(WIN_ATTR_ARCHIVE | WIN_ATTR_REPARSE_POINT),
      };
    },
  });

  assert.deepStrictEqual(result, { confirmed: true });
  assert.strictEqual(calls, 3);
});

test("windows verification fails closed when no placeholder ever appears", async (t) => {
  const { file } = tempFile(t);
  const clock = fakeClock();

  await assert.rejects(
    verifyOneDriveCloudFile(file, {
      platform: "win32",
      timeoutMs: 11,
      pollIntervalMs: 5,
      now: clock.now,
      delay: clock.delay,
      execFileImpl: async () => ({ stdout: String(WIN_ATTR_ARCHIVE) }),
    }),
    hasCode("CONFIRMATION_TIMEOUT")
  );
});
