"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FILE_NAME = "zotero-credentials.secure.json";
const FILE_VERSION = 1;
const MAX_FILE_BYTES = 32 * 1024;
const API_KEY_RE = /^[A-Za-z0-9]{24}$/;
const USER_ID_RE = /^[1-9][0-9]*$/;

class ZoteroCredentialError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ZoteroCredentialError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new ZoteroCredentialError(code, message, cause ? { cause } : undefined);
}

function normalizeCredentials(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_CREDENTIALS", "Zotero credentials must be an object");
  }

  const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : "";
  const rawUserId = value.userId;
  const userId =
    typeof rawUserId === "string"
      ? rawUserId.trim()
      : Number.isSafeInteger(rawUserId) && rawUserId > 0
        ? String(rawUserId)
        : "";

  if (!API_KEY_RE.test(apiKey)) {
    fail("INVALID_API_KEY", "Zotero API key must contain exactly 24 letters or digits");
  }
  if (!USER_ID_RE.test(userId)) {
    fail("INVALID_USER_ID", "Zotero user ID must be a positive integer");
  }

  return { apiKey, userId };
}

function secureStorageStatus(safeStorage, platform = process.platform) {
  if (
    !safeStorage ||
    typeof safeStorage.isEncryptionAvailable !== "function" ||
    typeof safeStorage.encryptString !== "function" ||
    typeof safeStorage.decryptString !== "function"
  ) {
    return { available: false, backend: null, code: "SECURE_STORAGE_UNAVAILABLE" };
  }

  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { available: false, backend: null, code: "SECURE_STORAGE_UNAVAILABLE" };
    }

    const backend =
      platform === "linux" && typeof safeStorage.getSelectedStorageBackend === "function"
        ? String(safeStorage.getSelectedStorageBackend() || "").toLowerCase()
        : null;
    // Electron's Linux `basic_text` backend deliberately stores an unencrypted
    // value. PaperReader never treats it as a usable credential store.
    if (backend === "basic_text" || backend === "plaintext" || backend === "plain_text") {
      return { available: false, backend, code: "INSECURE_STORAGE_BACKEND" };
    }
    if (
      platform === "linux" &&
      !["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(backend)
    ) {
      return { available: false, backend, code: "SECURE_STORAGE_UNAVAILABLE" };
    }
    return { available: true, backend, code: null };
  } catch {
    return { available: false, backend: null, code: "SECURE_STORAGE_UNAVAILABLE" };
  }
}

function validateBase64(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    fail("CREDENTIAL_FILE_INVALID", "Zotero credential file is invalid");
  }
  return Buffer.from(value, "base64");
}

function createZoteroCredentialStore(options = {}) {
  const safeStorage = options.safeStorage;
  const fsImpl = options.fsImpl || fs;
  const userDataDir = options.userDataDir;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const platform = options.platform || process.platform;

  if (typeof userDataDir !== "string" || !path.isAbsolute(userDataDir)) {
    throw new TypeError("userDataDir must be an absolute path");
  }

  const credentialFile = path.join(userDataDir, FILE_NAME);

  function assertSecureStorage() {
    const state = secureStorageStatus(safeStorage, platform);
    if (!state.available) {
      fail(
        state.code,
        state.code === "INSECURE_STORAGE_BACKEND"
          ? "The operating system only provides an insecure plaintext credential backend"
          : "Operating-system credential encryption is unavailable"
      );
    }
    return state;
  }

  function inspectFile() {
    let stat;
    try {
      stat = fsImpl.lstatSync(credentialFile);
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      fail("CREDENTIAL_READ_FAILED", "Could not inspect the Zotero credential file", error);
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail("CREDENTIAL_FILE_UNSAFE", "Zotero credential path is not a regular file");
    }
    if (stat.size > MAX_FILE_BYTES) {
      fail("CREDENTIAL_FILE_INVALID", "Zotero credential file is too large");
    }
    return stat;
  }

  function load() {
    if (!inspectFile()) return null;
    assertSecureStorage();

    let envelope;
    try {
      const raw = fsImpl.readFileSync(credentialFile, "utf8");
      envelope = JSON.parse(raw);
    } catch (error) {
      fail("CREDENTIAL_FILE_INVALID", "Could not parse the Zotero credential file", error);
    }
    if (
      !envelope ||
      typeof envelope !== "object" ||
      Array.isArray(envelope) ||
      envelope.version !== FILE_VERSION
    ) {
      fail("CREDENTIAL_FILE_INVALID", "Zotero credential file has an unsupported format");
    }

    const encrypted = validateBase64(envelope.ciphertext);
    let decrypted;
    try {
      decrypted = safeStorage.decryptString(encrypted);
    } catch (error) {
      fail("DECRYPTION_FAILED", "Could not decrypt the saved Zotero credentials", error);
    }
    if (typeof decrypted !== "string") {
      fail("DECRYPTION_FAILED", "Could not decrypt the saved Zotero credentials");
    }

    let parsed;
    try {
      parsed = JSON.parse(decrypted);
    } catch (error) {
      fail("CREDENTIAL_FILE_INVALID", "Decrypted Zotero credentials are invalid", error);
    }
    if (!parsed || parsed.version !== FILE_VERSION) {
      fail("CREDENTIAL_FILE_INVALID", "Decrypted Zotero credentials have an unsupported format");
    }
    return normalizeCredentials(parsed);
  }

  function status() {
    const secure = secureStorageStatus(safeStorage, platform);
    let stored = false;
    try {
      stored = !!inspectFile();
    } catch (error) {
      return {
        configured: false,
        stored: true,
        usable: false,
        encryptionAvailable: secure.available,
        backend: secure.backend,
        errorCode: error.code || "CREDENTIAL_READ_FAILED",
      };
    }

    if (!stored) {
      return {
        configured: false,
        stored: false,
        usable: false,
        encryptionAvailable: secure.available,
        backend: secure.backend,
        errorCode: secure.available ? null : secure.code,
      };
    }
    if (!secure.available) {
      return {
        configured: false,
        stored: true,
        usable: false,
        encryptionAvailable: false,
        backend: secure.backend,
        errorCode: secure.code,
      };
    }

    try {
      const credentials = load();
      return {
        configured: true,
        stored: true,
        usable: true,
        encryptionAvailable: true,
        backend: secure.backend,
        userId: credentials.userId,
        errorCode: null,
      };
    } catch (error) {
      return {
        configured: false,
        stored: true,
        usable: false,
        encryptionAvailable: true,
        backend: secure.backend,
        errorCode: error.code || "CREDENTIAL_READ_FAILED",
      };
    }
  }

  function save(value) {
    const credentials = normalizeCredentials(value);
    assertSecureStorage();

    const plaintext = JSON.stringify({ version: FILE_VERSION, ...credentials });
    let encrypted;
    try {
      encrypted = Buffer.from(safeStorage.encryptString(plaintext));
    } catch (error) {
      fail("ENCRYPTION_FAILED", "Could not encrypt the Zotero credentials", error);
    }
    if (!encrypted.length || encrypted.includes(Buffer.from(credentials.apiKey, "utf8"))) {
      fail("ENCRYPTION_FAILED", "The credential backend did not encrypt the Zotero API key");
    }

    const envelope = `${JSON.stringify({
      version: FILE_VERSION,
      ciphertext: encrypted.toString("base64"),
    })}\n`;
    const suffix = Buffer.from(randomBytes(12)).toString("hex");
    const temporaryFile = path.join(userDataDir, `.${FILE_NAME}.${process.pid}.${suffix}.tmp`);
    let fd = null;
    try {
      fsImpl.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
      fd = fsImpl.openSync(temporaryFile, "wx", 0o600);
      fsImpl.writeFileSync(fd, envelope, "utf8");
      fsImpl.fsyncSync(fd);
      fsImpl.closeSync(fd);
      fd = null;
      fsImpl.renameSync(temporaryFile, credentialFile);
      fsImpl.chmodSync(credentialFile, 0o600);
    } catch (error) {
      if (fd !== null) {
        try {
          fsImpl.closeSync(fd);
        } catch {}
      }
      try {
        fsImpl.unlinkSync(temporaryFile);
      } catch {}
      fail("CREDENTIAL_WRITE_FAILED", "Could not save the Zotero credentials", error);
    }
    return status();
  }

  function clear() {
    const existing = inspectFile();
    if (!existing) return { cleared: false };
    try {
      fsImpl.unlinkSync(credentialFile);
      return { cleared: true };
    } catch (error) {
      fail("CREDENTIAL_CLEAR_FAILED", "Could not clear the Zotero credentials", error);
    }
  }

  return Object.freeze({
    credentialFile: () => credentialFile,
    load,
    status,
    save,
    clear,
  });
}

module.exports = {
  API_KEY_RE,
  FILE_NAME,
  ZoteroCredentialError,
  createZoteroCredentialStore,
  normalizeCredentials,
  secureStorageStatus,
};
