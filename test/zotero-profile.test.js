const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const {
  baseAttachmentPathFromPrefs,
  profilePathFromIni,
  readZoteroBaseAttachmentPath,
} = require("../app/zotero-profile");

test("profilePathFromIni selects the default relative Zotero profile", () => {
  const ini = [
    "[Profile0]",
    "Name=old",
    "IsRelative=1",
    "Path=Profiles/old.default",
    "",
    "[Profile1]",
    "Name=default",
    "IsRelative=1",
    "Path=Profiles/current.default",
    "Default=1",
  ].join("\n");
  assert.strictEqual(
    profilePathFromIni(ini, "/Users/test/Library/Application Support/Zotero"),
    "/Users/test/Library/Application Support/Zotero/Profiles/current.default"
  );
});

test("profilePathFromIni follows a unique install-specific default", () => {
  const ini = [
    "[InstallA1B2C3]",
    "Default=Profiles/current.default",
    "Locked=1",
    "",
    "[Profile0]",
    "Name=old",
    "IsRelative=1",
    "Path=Profiles/old.default",
    "Default=1",
    "",
    "[Profile1]",
    "Name=current",
    "IsRelative=1",
    "Path=Profiles/current.default",
  ].join("\n");
  assert.strictEqual(
    profilePathFromIni(ini, "/Users/test/Library/Application Support/Zotero"),
    "/Users/test/Library/Application Support/Zotero/Profiles/current.default"
  );
});

test("baseAttachmentPathFromPrefs decodes the absolute pref string", () => {
  const prefs =
    'user_pref("extensions.zotero.baseAttachmentPath", "/Users/test/Library/CloudStorage/OneDrive-个人/Zotero-Attachments");';
  assert.strictEqual(
    baseAttachmentPathFromPrefs(prefs),
    "/Users/test/Library/CloudStorage/OneDrive-个人/Zotero-Attachments"
  );
});

test("readZoteroBaseAttachmentPath follows profiles.ini and rejects missing base prefs", () => {
  const homeDir = "/Users/test";
  const support = path.join(homeDir, "Library", "Application Support", "Zotero");
  const files = new Map([
    [path.join(support, "profiles.ini"), "[Profile0]\nIsRelative=1\nPath=Profiles/p.default\nDefault=1\n"],
    [
      path.join(support, "Profiles", "p.default", "prefs.js"),
      'user_pref("extensions.zotero.baseAttachmentPath", "/OneDrive/Zotero");',
    ],
  ]);
  const fsImpl = {
    readFileSync(file) {
      if (!files.has(file)) {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
      return files.get(file);
    },
  };
  assert.strictEqual(readZoteroBaseAttachmentPath({ homeDir, fsImpl }), "/OneDrive/Zotero");
  files.set(path.join(support, "Profiles", "p.default", "prefs.js"), "// no base path");
  assert.throws(
    () => readZoteroBaseAttachmentPath({ homeDir, fsImpl }),
    (error) => error.code === "ZOTERO_BASE_UNAVAILABLE"
  );
});
