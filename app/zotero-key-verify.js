"use strict";

const { API_KEY_RE } = require("./zotero-credentials");

const CURRENT_KEY_URL = "https://api.zotero.org/keys/current";

class ZoteroKeyVerificationError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ZoteroKeyVerificationError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
  }
}

function fail(code, message, options) {
  throw new ZoteroKeyVerificationError(code, message, options);
}

function normalizeApiKey(value) {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (!API_KEY_RE.test(apiKey)) {
    fail("INVALID_API_KEY", "Zotero API key must contain exactly 24 letters or digits");
  }
  return apiKey;
}

function normalizeUserId(value) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric > 0) return String(numeric);
  }
  fail("INVALID_RESPONSE", "Zotero returned an invalid user ID");
}

async function verifyZoteroApiKey(apiKeyValue, options = {}) {
  const apiKey = normalizeApiKey(apiKeyValue);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    fail("NETWORK_UNAVAILABLE", "No HTTP client is available for Zotero verification");
  }

  let response;
  try {
    response = await fetchImpl(CURRENT_KEY_URL, {
      method: "GET",
      headers: {
        "Zotero-API-Key": apiKey,
        "Zotero-API-Version": "3",
      },
      redirect: "error",
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if ((options.signal && options.signal.aborted) || (error && error.name === "AbortError")) {
      fail("REQUEST_ABORTED", "Zotero API key verification was cancelled or timed out");
    }
    // Deliberately do not include the fetch error: transports can echo headers.
    fail("NETWORK_ERROR", "Could not reach Zotero to verify the API key");
  }

  const status = response && Number.isInteger(response.status) ? response.status : 0;
  if (status === 401 || status === 403) {
    fail("AUTH_REJECTED", "Zotero rejected the API key", { status });
  }
  if (!response || response.ok !== true) {
    fail("HTTP_ERROR", "Zotero API key verification returned an HTTP error", { status });
  }

  let body;
  try {
    body = await response.json();
  } catch {
    fail("INVALID_RESPONSE", "Zotero returned an invalid verification response");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("INVALID_RESPONSE", "Zotero returned an invalid verification response");
  }

  const userId = normalizeUserId(body.userID);
  const userAccess = body.access && body.access.user;
  if (!userAccess || userAccess.library !== true || userAccess.write !== true) {
    fail(
      "INSUFFICIENT_PERMISSIONS",
      "The Zotero API key must allow read and write access to the personal library"
    );
  }

  return { apiKey, userId };
}

module.exports = {
  CURRENT_KEY_URL,
  ZoteroKeyVerificationError,
  normalizeApiKey,
  normalizeUserId,
  verifyZoteroApiKey,
};
