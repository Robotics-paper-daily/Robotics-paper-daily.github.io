// Safely materialise an arXiv PDF in Zotero's Linked Attachment Base Directory.
//
// This module deliberately knows nothing about Zotero's database.  The caller
// supplies the configured attachment root and can use the returned
// `attachments:<filename>` path when creating a linked-file attachment.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_STALE_TEMP_AGE_MS = 24 * 60 * 60 * 1000;
const TEMP_FILE_PATTERN = /^\.paperreader-zotero-\d+-[0-9a-f]{24}\.tmp$/;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PDF_CONTENT_TYPE = /^application\/pdf(?:\s*;|\s*$)/i;
const MODERN_ID = /^\d{4}\.\d{4,5}(?:v[1-9]\d*)?$/i;
const OLD_ID = /^[a-z][a-z0-9.-]*\/\d{7}(?:v[1-9]\d*)?$/i;

class ZoteroLinkedStoreError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ZoteroLinkedStoreError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new ZoteroLinkedStoreError(code, message, cause ? { cause } : undefined);
}

// Only the canonical HTTPS arxiv.org PDF endpoint is accepted.  In particular,
// look-alike domains and subdomains (including export.arxiv.org) are rejected.
function parseArxivPdfUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (err) {
    fail("INVALID_URL", "A valid arXiv PDF URL is required", err);
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "arxiv.org" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    fail("INVALID_URL", "Only canonical https://arxiv.org/pdf/... URLs are allowed");
  }

  const match = /^\/pdf\/(.+?)(?:\.pdf)?$/.exec(url.pathname);
  const id = match && match[1];
  if (!id || (!MODERN_ID.test(id) && !OLD_ID.test(id))) {
    fail("INVALID_URL", "The URL is not a canonical arXiv PDF URL");
  }

  // URL.pathname retains percent escapes.  Rejecting anything outside the ID
  // grammar also prevents encoded separators and traversal from becoming a
  // filename later.
  const filename = `${id.replace("/", "_")}.pdf`;
  return { url, id, filename };
}

async function resolveAttachmentRoot(root) {
  if (typeof root !== "string" || !root.trim() || !path.isAbsolute(root)) {
    fail("INVALID_ROOT", "The linked-attachment root must be a configured absolute directory");
  }

  let realRoot;
  try {
    realRoot = await fsp.realpath(root);
    const stat = await fsp.stat(realRoot);
    if (!stat.isDirectory()) fail("INVALID_ROOT", "The linked-attachment root is not a directory");
  } catch (err) {
    if (err instanceof ZoteroLinkedStoreError) throw err;
    fail("INVALID_ROOT", "The linked-attachment root is unavailable", err);
  }
  return realRoot;
}

function childPath(realRoot, filename) {
  const target = path.resolve(realRoot, filename);
  const relative = path.relative(realRoot, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    fail("PATH_ESCAPE", "The destination would escape the linked-attachment root");
  }
  return target;
}

async function sweepStaleTemps(options = {}) {
  const {
    root,
    minAgeMs = DEFAULT_STALE_TEMP_AGE_MS,
    now = Date.now(),
  } = options;
  if (!Number.isFinite(minAgeMs) || minAgeMs < 0 || !Number.isFinite(now)) {
    fail("INVALID_SWEEP_OPTIONS", "The stale-temp age and current time must be valid numbers");
  }

  const realRoot = await resolveAttachmentRoot(root);
  const cutoff = now - minAgeMs;
  let names;
  try {
    names = await fsp.readdir(realRoot);
  } catch (err) {
    fail("TEMP_SWEEP_FAILED", "Could not inspect stale linked-attachment temps", err);
  }

  let removed = 0;
  let skipped = 0;
  for (const name of names) {
    // Unrelated OneDrive/Zotero files are outside the sweep's universe and do
    // not affect either counter.
    if (!TEMP_FILE_PATTERN.test(name)) continue;
    const target = childPath(realRoot, name);
    let first;
    try {
      first = await fsp.lstat(target);
    } catch {
      skipped++;
      continue;
    }
    if (first.isSymbolicLink() || !first.isFile() || !(first.mtimeMs < cutoff)) {
      skipped++;
      continue;
    }

    // Narrow the lstat/unlink race: only unlink if a second lstat still sees
    // the same stale ordinary file. unlink itself never follows a symlink.
    try {
      const second = await fsp.lstat(target);
      if (
        second.isSymbolicLink() ||
        !second.isFile() ||
        !(second.mtimeMs < cutoff) ||
        second.dev !== first.dev ||
        second.ino !== first.ino
      ) {
        skipped++;
        continue;
      }
      await fsp.unlink(target);
      removed++;
    } catch {
      skipped++;
    }
  }
  return { removed, skipped };
}

function headersGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

async function fetchPdfResponse({ url, id, fetchImpl, signal, maxRedirects }) {
  let current = url;
  for (let redirects = 0; ; redirects++) {
    let response;
    try {
      response = await fetchImpl(current.href, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: { Accept: "application/pdf" },
      });
    } catch (err) {
      if (signal && signal.aborted) fail("DOWNLOAD_ABORTED", "The PDF download was aborted", err);
      fail("DOWNLOAD_INTERRUPTED", "The PDF download was interrupted", err);
    }

    if (!response || typeof response.status !== "number") {
      fail("INVALID_RESPONSE", "The PDF server returned an invalid response");
    }

    // A fetch implementation may ignore redirect:'manual'.  response.url lets
    // us still validate the effective destination before consuming any bytes.
    if (response.url) {
      const effective = parseArxivPdfUrl(response.url);
      if (effective.id.toLowerCase() !== id.toLowerCase()) {
        fail("REDIRECT_ID_MISMATCH", "The arXiv redirect changed the requested paper");
      }
    }

    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirects >= maxRedirects) fail("TOO_MANY_REDIRECTS", "Too many arXiv redirects");

    const location = headersGet(response.headers, "location");
    if (!location) fail("INVALID_REDIRECT", "The arXiv redirect did not include a destination");
    let next;
    try {
      next = new URL(location, current);
    } catch (err) {
      fail("INVALID_REDIRECT", "The arXiv redirect destination is invalid", err);
    }
    const parsed = parseArxivPdfUrl(next.href);
    if (parsed.id.toLowerCase() !== id.toLowerCase()) {
      fail("REDIRECT_ID_MISMATCH", "The arXiv redirect changed the requested paper");
    }
    current = parsed.url;
  }
}

async function writeAll(handle, chunk) {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
    if (!bytesWritten) fail("WRITE_FAILED", "Could not write the downloaded PDF");
    offset += bytesWritten;
  }
}

async function downloadToTemp({ response, tempPath, maxBytes, controller }) {
  if (response.status < 200 || response.status >= 300) {
    fail("HTTP_ERROR", `arXiv returned HTTP ${response.status}`);
  }
  const contentType = headersGet(response.headers, "content-type") || "";
  if (!PDF_CONTENT_TYPE.test(contentType)) {
    fail("NOT_PDF", "arXiv did not return a PDF content type");
  }
  const rawLength = headersGet(response.headers, "content-length");
  if (rawLength !== null && rawLength !== undefined && rawLength !== "") {
    const contentLength = Number(rawLength);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      controller.abort();
      fail("TOO_LARGE", "The PDF exceeds the configured size limit");
    }
  }
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
    fail("INVALID_RESPONSE", "The PDF response has no readable body");
  }

  let handle;
  let bytes = 0;
  let prefix = Buffer.alloc(0);
  const hash = crypto.createHash("sha256");
  try {
    handle = await fsp.open(tempPath, "wx", 0o600);
    for await (const value of response.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (!chunk.length) continue;
      if (bytes + chunk.length > maxBytes) {
        controller.abort();
        fail("TOO_LARGE", "The PDF exceeds the configured size limit");
      }
      if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk.subarray(0, 5 - prefix.length)]);
      await writeAll(handle, chunk);
      hash.update(chunk);
      bytes += chunk.length;
    }
    if (prefix.length < 5 || !prefix.equals(Buffer.from("%PDF-"))) {
      fail("NOT_PDF", "The downloaded file does not have a PDF header");
    }
    await handle.sync();
    await handle.close();
    handle = null;
    return { bytes, sha256: hash.digest("hex") };
  } catch (err) {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
    if (err instanceof ZoteroLinkedStoreError) throw err;
    if (controller.signal.aborted) fail("DOWNLOAD_ABORTED", "The PDF download was aborted", err);
    fail("DOWNLOAD_INTERRUPTED", "The PDF download was interrupted", err);
  }
}

async function inspectExisting(filePath, expected) {
  let lstat;
  try {
    lstat = await fsp.lstat(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return { state: "missing" };
    fail("DESTINATION_UNAVAILABLE", "Could not inspect an existing attachment", err);
  }
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    fail("UNSAFE_EXISTING_FILE", "The attachment destination is not a regular non-symlink file");
  }
  if (lstat.size !== expected.bytes) return { state: "different" };

  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let handle;
  try {
    handle = await fsp.open(filePath, fs.constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== expected.bytes) return { state: "different" };
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < stat.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - position), position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (position !== stat.size) return { state: "different" };
    return { state: hash.digest("hex") === expected.sha256 ? "same" : "different" };
  } catch (err) {
    fail("DESTINATION_UNAVAILABLE", "Could not verify an existing attachment", err);
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
  }
}

function validateSavedFilename(filename) {
  if (
    typeof filename !== "string" ||
    !filename ||
    !filename.trim() ||
    filename === "." ||
    filename === ".." ||
    filename.includes("/") ||
    filename.includes("\\") ||
    /[\0-\x1f\x7f]/.test(filename) ||
    path.basename(filename) !== filename ||
    path.win32.basename(filename) !== filename
  ) {
    fail("INVALID_FILENAME", "The saved PDF filename must be a safe flat filename");
  }
  return filename;
}

// Re-check the exact bytes after an external cloud-confirmation step. This is
// intentionally a fresh realpath/lstat/open/hash pass: callers must not assume
// that the path verified during the initial write is still the same object.
async function verifySavedPdf(options = {}) {
  const { root, filename: rawFilename, bytes, sha256 } = options;
  const filename = validateSavedFilename(rawFilename);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || !/^[0-9a-f]{64}$/i.test(String(sha256 || ""))) {
    fail("INVALID_SAVED_FILE", "Valid saved PDF size and SHA-256 metadata are required");
  }

  const realRoot = await resolveAttachmentRoot(root);
  const target = childPath(realRoot, filename);
  const result = await inspectExisting(target, {
    bytes,
    sha256: String(sha256).toLowerCase(),
  });
  if (result.state === "missing") {
    fail("SAVED_FILE_MISSING", "The saved PDF is no longer present");
  }
  if (result.state !== "same") {
    fail("SAVED_FILE_CHANGED", "The saved PDF changed after it was written");
  }
  return { ok: true };
}

async function commitWithoutOverwrite(tempPath, destination) {
  try {
    // A hard-link is an atomic no-replace commit on the same filesystem.  The
    // temporary name is removed only after the final name is visible.
    await fsp.link(tempPath, destination);
    return true;
  } catch (err) {
    if (err && err.code === "EEXIST") return false;
    // Some cloud-backed filesystems do not support hard links. COPYFILE_EXCL
    // preserves the essential no-overwrite guarantee in that case.
    if (err && ["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "EMLINK"].includes(err.code)) {
      try {
        await fsp.copyFile(tempPath, destination, fs.constants.COPYFILE_EXCL);
        const handle = await fsp.open(destination, "r");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        return true;
      } catch (copyErr) {
        if (copyErr && copyErr.code === "EEXIST") return false;
        fail("COMMIT_FAILED", "Could not commit the linked attachment", copyErr);
      }
    }
    fail("COMMIT_FAILED", "Could not commit the linked attachment", err);
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fsp.open(directory, "r");
    await handle.sync();
  } catch {
    // Directory fsync is unavailable on some platforms. The file itself has
    // already been fsynced, so this is a best-effort durability enhancement.
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
  }
}

async function placeDownloadedFile({ realRoot, requestedFilename, tempPath, bytes, sha256 }) {
  const expected = { bytes, sha256 };
  const primary = childPath(realRoot, requestedFilename);

  for (;;) {
    const current = await inspectExisting(primary, expected);
    if (current.state === "same") return { state: "reused", filename: requestedFilename };
    if (current.state === "missing") {
      if (await commitWithoutOverwrite(tempPath, primary)) {
        await syncDirectory(realRoot);
        return { state: "stored", filename: requestedFilename };
      }
      continue; // Lost a race; verify the winner instead of overwriting it.
    }
    break;
  }

  const extension = path.extname(requestedFilename);
  const stem = requestedFilename.slice(0, -extension.length);
  const hashedFilename = `${stem}.${sha256}${extension}`;
  const hashed = childPath(realRoot, hashedFilename);
  for (;;) {
    const current = await inspectExisting(hashed, expected);
    if (current.state === "same") return { state: "reused", filename: hashedFilename };
    if (current.state === "different") {
      fail("HASH_CONFLICT", "A different file already occupies the content-addressed attachment path");
    }
    if (await commitWithoutOverwrite(tempPath, hashed)) {
      await syncDirectory(realRoot);
      return { state: "stored-with-hash", filename: hashedFilename };
    }
  }
}

async function saveArxivPdf(options = {}) {
  const {
    root,
    url: rawUrl,
    fetchImpl = globalThis.fetch,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = 5,
    signal,
  } = options;
  if (typeof fetchImpl !== "function") fail("FETCH_UNAVAILABLE", "No PDF fetch implementation is available");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 5) {
    fail("INVALID_LIMIT", "The PDF size limit must be an integer of at least five bytes");
  }
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    fail("INVALID_LIMIT", "The redirect limit must be a non-negative integer");
  }

  const parsed = parseArxivPdfUrl(rawUrl);
  const realRoot = await resolveAttachmentRoot(root);
  await sweepStaleTemps({ root: realRoot });
  const tempName = `.paperreader-zotero-${process.pid}-${crypto.randomBytes(12).toString("hex")}.tmp`;
  const tempPath = childPath(realRoot, tempName);
  const controller = new AbortController();
  const abort = () => controller.abort(signal && signal.reason);
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }

  try {
    if (controller.signal.aborted) fail("DOWNLOAD_ABORTED", "The PDF download was aborted");
    const response = await fetchPdfResponse({
      url: parsed.url,
      id: parsed.id,
      fetchImpl,
      signal: controller.signal,
      maxRedirects,
    });
    const downloaded = await downloadToTemp({ response, tempPath, maxBytes, controller });
    const placed = await placeDownloadedFile({
      realRoot,
      requestedFilename: parsed.filename,
      tempPath,
      ...downloaded,
    });
    return {
      ok: true,
      state: placed.state,
      filename: placed.filename,
      zoteroPath: `attachments:${placed.filename}`,
      bytes: downloaded.bytes,
      sha256: downloaded.sha256,
    };
  } finally {
    if (signal) signal.removeEventListener("abort", abort);
    try {
      await fsp.unlink(tempPath);
    } catch (err) {
      if (!err || err.code !== "ENOENT") {
        // A stale private temp is safer than risking removal of anything else.
      }
    }
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_STALE_TEMP_AGE_MS,
  ZoteroLinkedStoreError,
  parseArxivPdfUrl,
  saveArxivPdf,
  sweepStaleTemps,
  verifySavedPdf,
};
