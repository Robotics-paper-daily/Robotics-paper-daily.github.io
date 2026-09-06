const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const {
  baseAttachmentPathFromPrefs,
  profilePathFromIni,
  readZoteroBaseAttachmentPath,
  zoteroSupportDir,
} = require("../app/zotero-profile");

// Drive-agnostic absolute fixtures so the same expectations hold on POSIX and
// Windows checkouts (path.resolve would otherwise prefix the current drive).
const ROOT = path.parse(process.cwd()).root;
const MAC_HOME = path.join(ROOT, "Users", "test");
const MAC_SUPPORT = path.join(MAC_HOME, "Library", "Application Support", "Zotero");

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
    profilePathFromIni(ini, MAC_SUPPORT),
    path.join(MAC_SUPPORT, "Profiles", "current.default")
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
    profilePathFromIni(ini, MAC_SUPPORT),
    path.join(MAC_SUPPORT, "Profiles", "current.default")
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

test("baseAttachmentPathFromPrefs decodes an escaped Windows pref string", () => {
  // Zotero writes Windows paths with JSON-escaped backslashes in prefs.js.
  // Absoluteness is judged by the running platform, so a drive-letter path is
  // only accepted where it actually is absolute.
  const prefs =
    'user_pref("extensions.zotero.baseAttachmentPath", "C:\\\\Users\\\\test\\\\OneDrive\\\\Zotero-Attachments");';
  if (process.platform === "win32") {
    assert.strictEqual(
      baseAttachmentPathFromPrefs(prefs),
      "C:\\Users\\test\\OneDrive\\Zotero-Attachments"
    );
  } else {
    assert.throws(
      () => baseAttachmentPathFromPrefs(prefs),
      (error) => error.code === "ZOTERO_BASE_UNAVAILABLE"
    );
  }
});

test("zoteroSupportDir maps each supported platform and rejects the rest", () => {
  assert.strictEqual(
    zoteroSupportDir({ homeDir: MAC_HOME, platform: "darwin" }),
    MAC_SUPPORT
  );
  const winHome = path.join(ROOT, "Users", "test");
  assert.strictEqual(
    zoteroSupportDir({
      homeDir: winHome,
      appDataDir: path.join(winHome, "AppData", "Roaming"),
      platform: "win32",
    }),
    path.join(winHome, "AppData", "Roaming", "Zotero", "Zotero")
  );
  // Missing %APPDATA% falls back to the documented Roaming location.
  assert.strictEqual(
    zoteroSupportDir({ homeDir: winHome, platform: "win32" }),
    path.join(winHome, "AppData", "Roaming", "Zotero", "Zotero")
  );
  assert.strictEqual(zoteroSupportDir({ homeDir: MAC_HOME, platform: "linux" }), null);
});

function mapFsImpl(files) {
  return {
    readFileSync(file) {
      if (!files.has(file)) {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
      return files.get(file);
    },
  };
}

test("readZoteroBaseAttachmentPath follows profiles.ini and rejects missing base prefs", () => {
  const homeDir = MAC_HOME;
  const support = MAC_SUPPORT;
  const base = path.join(ROOT, "OneDrive", "Zotero");
  const files = new Map([
    [path.join(support, "profiles.ini"), "[Profile0]\nIsRelative=1\nPath=Profiles/p.default\nDefault=1\n"],
    [
      path.join(support, "Profiles", "p.default", "prefs.js"),
      `user_pref("extensions.zotero.baseAttachmentPath", ${JSON.stringify(base)});`,
    ],
  ]);
  const fsImpl = mapFsImpl(files);
  assert.strictEqual(
    readZoteroBaseAttachmentPath({ homeDir, fsImpl, platform: "darwin" }),
    base
  );
  files.set(path.join(support, "Profiles", "p.default", "prefs.js"), "// no base path");
  assert.throws(
    () => readZoteroBaseAttachmentPath({ homeDir, fsImpl, platform: "darwin" }),
    (error) => error.code === "ZOTERO_BASE_UNAVAILABLE"
  );
});

test("readZoteroBaseAttachmentPath reads the Windows Roaming profile layout", () => {
  const homeDir = path.join(ROOT, "Users", "test");
  const appDataDir = path.join(homeDir, "AppData", "Roaming");
  const support = path.join(appDataDir, "Zotero", "Zotero");
  const base = path.join(homeDir, "OneDrive", "Zotero-Attachments");
  const files = new Map([
    [path.join(support, "profiles.ini"), "[Profile0]\nIsRelative=1\nPath=Profiles/w.default\nDefault=1\n"],
    [
      path.join(support, "Profiles", "w.default", "prefs.js"),
      `user_pref("extensions.zotero.baseAttachmentPath", ${JSON.stringify(base)});`,
    ],
  ]);
  assert.strictEqual(
    readZoteroBaseAttachmentPath({
      homeDir,
      appDataDir,
      fsImpl: mapFsImpl(files),
      platform: "win32",
    }),
    base
  );
});

test("readZoteroBaseAttachmentPath fails closed on unsupported platforms", () => {
  assert.throws(
    () => readZoteroBaseAttachmentPath({ homeDir: MAC_HOME, platform: "linux" }),
    (error) => error.code === "ZOTERO_PROFILE_UNAVAILABLE"
  );
});
