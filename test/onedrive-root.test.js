"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  WINDOWS_ONEDRIVE_ENV_KEYS,
  windowsOneDriveRoots,
  isWithinRoot,
} = require("../app/onedrive-root");

const ROOT = path.parse(process.cwd()).root;
const HOME = path.join(ROOT, "Users", "test");

test("windowsOneDriveRoots collects absolute, deduplicated sync roots from the env", () => {
  const personal = path.join(HOME, "OneDrive");
  const business = path.join(HOME, "OneDrive - Contoso");
  assert.deepEqual(
    windowsOneDriveRoots({
      OneDrive: personal,
      OneDriveConsumer: personal,
      OneDriveCommercial: ` ${business} `,
    }),
    [personal, business]
  );
  assert.deepEqual(windowsOneDriveRoots({}), []);
  assert.deepEqual(
    windowsOneDriveRoots({ OneDrive: "relative\\path", OneDriveConsumer: "" }),
    []
  );
  assert.deepEqual(WINDOWS_ONEDRIVE_ENV_KEYS.length, 3);
});

test("isWithinRoot accepts the root itself and children, rejects escapes", () => {
  const root = path.join(HOME, "OneDrive");
  assert.equal(isWithinRoot(root, root), true);
  assert.equal(isWithinRoot(root, path.join(root, "Zotero-Attachments")), true);
  assert.equal(isWithinRoot(root, path.join(root, "a", "b", "c.pdf")), true);
  assert.equal(isWithinRoot(root, HOME), false);
  assert.equal(isWithinRoot(root, path.join(HOME, "OneDrive-evil")), false);
  assert.equal(isWithinRoot(root, path.join(ROOT, "elsewhere")), false);
});

test("isWithinRoot compares case-insensitively on Windows", (t) => {
  if (process.platform !== "win32") {
    t.skip("path.relative is case-insensitive only on win32");
    return;
  }
  const root = path.join(HOME, "OneDrive");
  assert.equal(isWithinRoot(root.toLowerCase(), path.join(root.toUpperCase(), "sub")), true);
});
