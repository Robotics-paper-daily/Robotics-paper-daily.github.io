"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  FILE_NAME,
  createZoteroCredentialStore,
  normalizeCredentials,
  secureStorageStatus,
} = require("../app/zotero-credentials");

// Repeated characters are intentionally unmistakable release-audit fixtures,
// never values copied from a Zotero account.
const API_KEY = "AAAAAAAAAAAAAAAAAAAAAAAA";

function makeSafeStorage(options = {}) {
  const storage = {
    isEncryptionAvailable: () => options.available !== false,
    getSelectedStorageBackend: () => options.backend || "keychain",
    encryptString: (text) => {
      if (options.encryptError) throw options.encryptError;
      if (options.plaintext) return Buffer.from(text, "utf8");
      return Buffer.from(text, "utf8").map((byte) => byte ^ 0xa5);
    },
    decryptString: (encrypted) => {
      if (options.decryptError) throw options.decryptError;
      return Buffer.from(encrypted).map((byte) => byte ^ 0xa5).toString("utf8");
    },
  };
  return storage;
}

function tempStore(t, storage = makeSafeStorage(), platform = process.platform) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-zotero-credentials-"));
  t.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));
  return {
    userDataDir,
    store: createZoteroCredentialStore({
      safeStorage: storage,
      userDataDir,
      randomBytes: () => Buffer.alloc(12, 7),
      platform,
    }),
  };
}

test("validates and normalizes Zotero API keys and user IDs", () => {
  assert.deepStrictEqual(normalizeCredentials({ apiKey: ` ${API_KEY} `, userId: 12345 }), {
    apiKey: API_KEY,
    userId: "12345",
  });
  assert.throws(
    () => normalizeCredentials({ apiKey: "short", userId: "123" }),
    (error) => error.code === "INVALID_API_KEY"
  );
  assert.throws(
    () => normalizeCredentials({ apiKey: API_KEY, userId: "0" }),
    (error) => error.code === "INVALID_USER_ID"
  );
  assert.throws(
    () => normalizeCredentials({ apiKey: API_KEY, userId: "12.5" }),
    (error) => error.code === "INVALID_USER_ID"
  );
});

test("round-trips an encrypted credential file without exposing the API key", (t) => {
  const { userDataDir, store } = tempStore(t);
  const saved = store.save({ apiKey: API_KEY, userId: "98765" });

  assert.deepStrictEqual(store.load(), { apiKey: API_KEY, userId: "98765" });
  assert.strictEqual(saved.configured, true);
  assert.strictEqual(saved.usable, true);
  assert.strictEqual(saved.userId, "98765");
  assert.ok(!Object.prototype.hasOwnProperty.call(saved, "apiKey"));

  const file = path.join(userDataDir, FILE_NAME);
  const disk = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(disk, new RegExp(API_KEY));
  assert.doesNotMatch(disk, /98765/);
  if (process.platform !== "win32") {
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  }
  assert.deepStrictEqual(
    fs.readdirSync(userDataDir).filter((name) => name.endsWith(".tmp")),
    []
  );

  // A fresh store instance models closing and restarting PaperReader. The
  // ciphertext must remain decryptable without any in-memory session state.
  const restartedStore = createZoteroCredentialStore({
    safeStorage: makeSafeStorage(),
    userDataDir,
    randomBytes: () => Buffer.alloc(12, 8),
    platform: process.platform,
  });
  assert.deepStrictEqual(restartedStore.load(), { apiKey: API_KEY, userId: "98765" });
  assert.strictEqual(restartedStore.status().configured, true);
  assert.strictEqual(restartedStore.status().usable, true);
});

test("status reports missing credentials without returning secret fields", (t) => {
  const { store } = tempStore(t);
  const status = store.status();
  assert.deepStrictEqual(status, {
    configured: false,
    stored: false,
    usable: false,
    encryptionAvailable: true,
    backend: null,
    errorCode: null,
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(status, "apiKey"));
  assert.strictEqual(store.load(), null);
});

test("never falls back to disk when secure encryption is unavailable", (t) => {
  const { userDataDir, store } = tempStore(t, makeSafeStorage({ available: false }));
  assert.throws(
    () => store.save({ apiKey: API_KEY, userId: "42" }),
    (error) => error.code === "SECURE_STORAGE_UNAVAILABLE"
  );
  assert.strictEqual(fs.existsSync(path.join(userDataDir, FILE_NAME)), false);
  assert.strictEqual(store.status().encryptionAvailable, false);
});

test("rejects Electron's plaintext basic_text backend", (t) => {
  const storage = makeSafeStorage({ backend: "basic_text" });
  const { userDataDir, store } = tempStore(t, storage, "linux");
  assert.deepStrictEqual(secureStorageStatus(storage, "linux"), {
    available: false,
    backend: "basic_text",
    code: "INSECURE_STORAGE_BACKEND",
  });
  assert.throws(
    () => store.save({ apiKey: API_KEY, userId: "42" }),
    (error) => error.code === "INSECURE_STORAGE_BACKEND"
  );
  assert.strictEqual(fs.existsSync(path.join(userDataDir, FILE_NAME)), false);
});

test("fails closed for an unknown Linux password backend", (t) => {
  const storage = makeSafeStorage({ backend: "unknown" });
  const { store } = tempStore(t, storage, "linux");
  assert.throws(
    () => store.save({ apiKey: API_KEY, userId: "42" }),
    (error) => error.code === "SECURE_STORAGE_UNAVAILABLE"
  );
});

test("does not call the Linux-only backend probe on macOS or Windows", (t) => {
  const storage = makeSafeStorage();
  storage.getSelectedStorageBackend = () => {
    throw new Error("Linux-only API called");
  };
  const { store } = tempStore(t, storage, "darwin");
  assert.strictEqual(store.status().encryptionAvailable, true);
  store.save({ apiKey: API_KEY, userId: "42" });
  assert.deepStrictEqual(store.load(), { apiKey: API_KEY, userId: "42" });
});

test("rejects a credential backend that returns the plaintext", (t) => {
  const { userDataDir, store } = tempStore(t, makeSafeStorage({ plaintext: true }));
  assert.throws(
    () => store.save({ apiKey: API_KEY, userId: "42" }),
    (error) => error.code === "ENCRYPTION_FAILED"
  );
  assert.strictEqual(fs.existsSync(path.join(userDataDir, FILE_NAME)), false);
});

test("a failed replacement preserves the previously saved credentials", (t) => {
  const storage = makeSafeStorage();
  const { store } = tempStore(t, storage);
  store.save({ apiKey: API_KEY, userId: "42" });

  storage.encryptString = () => {
    throw new Error("keychain unavailable");
  };
  assert.throws(
    () => store.save({ apiKey: "BBBBBBBBBBBBBBBBBBBBBBBB", userId: "43" }),
    (error) => error.code === "ENCRYPTION_FAILED"
  );
  storage.encryptString = makeSafeStorage().encryptString;
  assert.deepStrictEqual(store.load(), { apiKey: API_KEY, userId: "42" });
});

test("corrupt files are unusable and clearing removes them without decryption", (t) => {
  const { userDataDir, store } = tempStore(t);
  const file = path.join(userDataDir, FILE_NAME);
  fs.writeFileSync(file, "{broken", { mode: 0o600 });

  assert.strictEqual(store.status().configured, false);
  assert.strictEqual(store.status().stored, true);
  assert.strictEqual(store.status().errorCode, "CREDENTIAL_FILE_INVALID");
  assert.deepStrictEqual(store.clear(), { cleared: true });
  assert.deepStrictEqual(store.clear(), { cleared: false });
});

test("refuses to follow a symlink at the credential path", (t) => {
  if (process.platform === "win32") return;
  const { userDataDir, store } = tempStore(t);
  const target = path.join(userDataDir, "target.txt");
  fs.writeFileSync(target, "do not delete");
  fs.symlinkSync(target, path.join(userDataDir, FILE_NAME));

  assert.throws(
    () => store.load(),
    (error) => error.code === "CREDENTIAL_FILE_UNSAFE"
  );
  assert.throws(
    () => store.clear(),
    (error) => error.code === "CREDENTIAL_FILE_UNSAFE"
  );
  assert.strictEqual(fs.readFileSync(target, "utf8"), "do not delete");
});
