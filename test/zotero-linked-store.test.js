const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");

const {
  DEFAULT_STALE_TEMP_AGE_MS,
  ZoteroLinkedStoreError,
  parseArxivPdfUrl,
  saveArxivPdf,
  sweepStaleTemps,
  verifySavedPdf,
} = require("../app/zotero-linked-store");

const URL = "https://arxiv.org/pdf/2608.01234v2";
const PDF = Buffer.from("%PDF-1.7\nsmall test pdf\n%%EOF\n");

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-zotero-linked-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function response(body = PDF, options = {}) {
  const headers = new Headers({ "content-type": "application/pdf", ...(options.headers || {}) });
  return {
    status: options.status === undefined ? 200 : options.status,
    headers,
    body: body === null || (body && typeof body[Symbol.asyncIterator] === "function")
      ? body
      : Readable.from([body]),
    url: options.url || "",
  };
}

function fetchBody(body = PDF, options = {}) {
  return async () => response(body, options);
}

function tempFiles(root) {
  return fs.readdirSync(root).filter((name) => name.endsWith(".tmp"));
}

function errorCode(code) {
  return (err) => err instanceof ZoteroLinkedStoreError && err.code === code;
}

test("stores a validated PDF and returns only Zotero-relative metadata", async (t) => {
  const root = tempRoot(t);
  const result = await saveArxivPdf({ root, url: URL, fetchImpl: fetchBody() });

  assert.deepStrictEqual(result, {
    ok: true,
    state: "stored",
    filename: "2608.01234v2.pdf",
    zoteroPath: "attachments:2608.01234v2.pdf",
    bytes: PDF.length,
    sha256: crypto.createHash("sha256").update(PDF).digest("hex"),
  });
  assert.strictEqual(fs.readFileSync(path.join(root, result.filename)).toString(), PDF.toString());
  assert.strictEqual(Object.values(result).includes(root), false);
  assert.deepStrictEqual(tempFiles(root), []);
});

test("download temps use only the narrow non-user-derived prefix", async (t) => {
  const root = tempRoot(t);
  let observed = [];
  const body = {
    async *[Symbol.asyncIterator]() {
      observed = fs.readdirSync(root).filter((name) => name.endsWith(".tmp"));
      yield PDF;
    },
  };

  await saveArxivPdf({ root, url: URL, fetchImpl: fetchBody(body) });
  assert.strictEqual(observed.length, 1);
  assert.match(observed[0], /^\.paperreader-zotero-\d+-[0-9a-f]{24}\.tmp$/);
  assert.doesNotMatch(observed[0], /2608|01234/i);
  assert.deepStrictEqual(tempFiles(root), []);
});

test("old-style arXiv ids are flattened safely and keep their version", async (t) => {
  const root = tempRoot(t);
  const result = await saveArxivPdf({
    root,
    url: "https://arxiv.org/pdf/hep-th/9901001v3.pdf",
    fetchImpl: fetchBody(),
  });
  assert.strictEqual(result.filename, "hep-th_9901001v3.pdf");
  assert.strictEqual(result.zoteroPath, "attachments:hep-th_9901001v3.pdf");
  assert.ok(fs.statSync(path.join(root, result.filename)).isFile());
});

test("rejects non-canonical hosts, protocols, paths, ports, and encoded separators", async (t) => {
  const root = tempRoot(t);
  const invalid = [
    "http://arxiv.org/pdf/2608.01234",
    "https://export.arxiv.org/pdf/2608.01234",
    "https://arxiv.org.evil.test/pdf/2608.01234",
    "https://arxiv.org:444/pdf/2608.01234",
    "https://arxiv.org/abs/2608.01234",
    "https://arxiv.org/pdf/2608.01234?download=1",
    "https://arxiv.org/pdf/hep-th%2F9901001",
    "https://arxiv.org/pdf/../2608.01234",
  ];
  let fetched = 0;
  for (const url of invalid) {
    await assert.rejects(
      saveArxivPdf({ root, url, fetchImpl: async () => { fetched++; return response(); } }),
      errorCode("INVALID_URL"),
      url
    );
  }
  assert.strictEqual(fetched, 0);
  assert.deepStrictEqual(fs.readdirSync(root), []);
});

test("requires an existing absolute directory as the configured root", async (t) => {
  const root = tempRoot(t);
  await assert.rejects(
    saveArxivPdf({ root: "relative/attachments", url: URL, fetchImpl: fetchBody() }),
    errorCode("INVALID_ROOT")
  );
  await assert.rejects(
    saveArxivPdf({ root: path.join(root, "missing"), url: URL, fetchImpl: fetchBody() }),
    errorCode("INVALID_ROOT")
  );
});

test("validates every redirect and the effective response URL", async (t) => {
  const root = tempRoot(t);
  await assert.rejects(
    saveArxivPdf({
      root,
      url: URL,
      fetchImpl: async () => response(null, {
        status: 302,
        headers: { location: "https://evil.test/pdf/2608.01234v2" },
      }),
    }),
    errorCode("INVALID_URL")
  );

  await assert.rejects(
    saveArxivPdf({
      root,
      url: URL,
      fetchImpl: async () => response(PDF, { url: "https://export.arxiv.org/pdf/2608.01234v2" }),
    }),
    errorCode("INVALID_URL")
  );

  let calls = 0;
  const result = await saveArxivPdf({
    root,
    url: URL,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) {
        return response(null, { status: 302, headers: { location: "/pdf/2608.01234v2.pdf" } });
      }
      return response(PDF, { url: "https://arxiv.org/pdf/2608.01234v2.pdf" });
    },
  });
  assert.strictEqual(calls, 2);
  assert.strictEqual(result.filename, "2608.01234v2.pdf");
});

test("rejects HTTP failures, false content types, and false PDF bodies", async (t) => {
  const root = tempRoot(t);
  await assert.rejects(
    saveArxivPdf({ root, url: URL, fetchImpl: fetchBody(PDF, { status: 404 }) }),
    errorCode("HTTP_ERROR")
  );
  await assert.rejects(
    saveArxivPdf({
      root,
      url: URL,
      fetchImpl: fetchBody(Buffer.from("<html>nope</html>"), { headers: { "content-type": "text/html" } }),
    }),
    errorCode("NOT_PDF")
  );
  await assert.rejects(
    saveArxivPdf({ root, url: URL, fetchImpl: fetchBody(Buffer.from("not a pdf")) }),
    errorCode("NOT_PDF")
  );
  assert.deepStrictEqual(fs.readdirSync(root), []);
});

test("enforces declared and streamed size limits and cleans partial temps", async (t) => {
  const root = tempRoot(t);
  await assert.rejects(
    saveArxivPdf({
      root,
      url: URL,
      maxBytes: 16,
      fetchImpl: fetchBody(PDF, { headers: { "content-length": String(PDF.length) } }),
    }),
    errorCode("TOO_LARGE")
  );
  assert.deepStrictEqual(fs.readdirSync(root), []);

  const streamed = Readable.from([Buffer.from("%PDF-"), Buffer.alloc(20, 1)]);
  await assert.rejects(
    saveArxivPdf({ root, url: URL, maxBytes: 16, fetchImpl: fetchBody(streamed) }),
    errorCode("TOO_LARGE")
  );
  assert.deepStrictEqual(fs.readdirSync(root), []);
});

test("an interrupted stream and an aborted request leave no temp file", async (t) => {
  const root = tempRoot(t);
  const interrupted = Readable.from((async function* () {
    yield Buffer.from("%PDF-");
    throw new Error("connection reset");
  })());
  await assert.rejects(
    saveArxivPdf({ root, url: URL, fetchImpl: fetchBody(interrupted) }),
    errorCode("DOWNLOAD_INTERRUPTED")
  );
  assert.deepStrictEqual(fs.readdirSync(root), []);

  const controller = new AbortController();
  controller.abort();
  let fetched = false;
  await assert.rejects(
    saveArxivPdf({
      root,
      url: URL,
      signal: controller.signal,
      fetchImpl: async () => { fetched = true; return response(); },
    }),
    errorCode("DOWNLOAD_ABORTED")
  );
  assert.strictEqual(fetched, false);
  assert.deepStrictEqual(fs.readdirSync(root), []);
});

test("reuses an identical regular PDF without replacing it", async (t) => {
  const root = tempRoot(t);
  const destination = path.join(root, "2608.01234v2.pdf");
  fs.writeFileSync(destination, PDF);
  const before = fs.statSync(destination);

  const result = await saveArxivPdf({ root, url: URL, fetchImpl: fetchBody() });
  const after = fs.statSync(destination);
  assert.strictEqual(result.state, "reused");
  assert.strictEqual(result.filename, "2608.01234v2.pdf");
  assert.strictEqual(after.ino, before.ino);
  assert.strictEqual(fs.readFileSync(destination).toString(), PDF.toString());
  assert.deepStrictEqual(tempFiles(root), []);
});

test("never overwrites a conflicting PDF and deterministically reuses the hash-suffixed copy", async (t) => {
  const root = tempRoot(t);
  const primary = path.join(root, "2608.01234v2.pdf");
  const original = Buffer.from("%PDF-1.4\noriginal and different\n");
  fs.writeFileSync(primary, original);
  const digest = crypto.createHash("sha256").update(PDF).digest("hex");

  const first = await saveArxivPdf({ root, url: URL, fetchImpl: fetchBody() });
  assert.strictEqual(first.state, "stored-with-hash");
  assert.strictEqual(first.filename, `2608.01234v2.${digest}.pdf`);
  assert.deepStrictEqual(fs.readFileSync(primary), original);
  assert.deepStrictEqual(fs.readFileSync(path.join(root, first.filename)), PDF);

  const second = await saveArxivPdf({ root, url: URL, fetchImpl: fetchBody() });
  assert.strictEqual(second.state, "reused");
  assert.strictEqual(second.filename, first.filename);
  assert.deepStrictEqual(fs.readFileSync(primary), original);
  assert.deepStrictEqual(fs.readdirSync(root).sort(), [first.filename, "2608.01234v2.pdf"].sort());
});

test("rejects an existing symlink destination without following or replacing it", async (t) => {
  const root = tempRoot(t);
  const outside = path.join(os.tmpdir(), `paperreader-outside-${crypto.randomBytes(8).toString("hex")}.pdf`);
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.writeFileSync(outside, "%PDF-1.4\noutside\n");
  try {
    fs.symlinkSync(outside, path.join(root, "2608.01234v2.pdf"));
  } catch {
    t.skip("symlinks unavailable on this platform");
    return;
  }

  await assert.rejects(
    saveArxivPdf({ root, url: URL, fetchImpl: fetchBody() }),
    errorCode("UNSAFE_EXISTING_FILE")
  );
  assert.strictEqual(fs.readFileSync(outside, "utf8"), "%PDF-1.4\noutside\n");
  assert.ok(fs.lstatSync(path.join(root, "2608.01234v2.pdf")).isSymbolicLink());
  assert.deepStrictEqual(tempFiles(root), []);
});

test("URL parser exposes only a safe flat filename", () => {
  assert.deepStrictEqual(
    { ...parseArxivPdfUrl("https://arxiv.org/pdf/math.GT/0309136v4.pdf"), url: undefined },
    { url: undefined, id: "math.GT/0309136v4", filename: "math.GT_0309136v4.pdf" }
  );
});

test("verifySavedPdf re-hashes the saved regular file", async (t) => {
  const root = tempRoot(t);
  const saved = await saveArxivPdf({ root, url: URL, fetchImpl: fetchBody() });

  assert.deepStrictEqual(
    await verifySavedPdf({
      root,
      filename: saved.filename,
      bytes: saved.bytes,
      sha256: saved.sha256.toUpperCase(),
    }),
    { ok: true }
  );
});

test("verifySavedPdf reports stable missing and changed-file codes", async (t) => {
  const root = tempRoot(t);
  const saved = await saveArxivPdf({ root, url: URL, fetchImpl: fetchBody() });
  const target = path.join(root, saved.filename);

  fs.writeFileSync(target, Buffer.from(PDF.toString().replace("small", "SMALL")));
  await assert.rejects(
    verifySavedPdf({ root, filename: saved.filename, bytes: saved.bytes, sha256: saved.sha256 }),
    errorCode("SAVED_FILE_CHANGED")
  );

  fs.unlinkSync(target);
  await assert.rejects(
    verifySavedPdf({ root, filename: saved.filename, bytes: saved.bytes, sha256: saved.sha256 }),
    errorCode("SAVED_FILE_MISSING")
  );
});

test("verifySavedPdf rejects unsafe flat filenames before resolving a target", async (t) => {
  const root = tempRoot(t);
  const metadata = { root, bytes: PDF.length, sha256: crypto.createHash("sha256").update(PDF).digest("hex") };
  for (const filename of ["", "   ", ".", "..", "/tmp/paper.pdf", "sub/paper.pdf", "sub\\paper.pdf", "bad\0.pdf"]) {
    await assert.rejects(verifySavedPdf({ ...metadata, filename }), errorCode("INVALID_FILENAME"), filename);
  }
  assert.deepStrictEqual(fs.readdirSync(root), []);
});

test("verifySavedPdf refuses symlinks even when their target bytes match", async (t) => {
  const root = tempRoot(t);
  const filename = "2608.01234v2.pdf";
  const outside = path.join(os.tmpdir(), `paperreader-verify-${crypto.randomBytes(8).toString("hex")}.pdf`);
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.writeFileSync(outside, PDF);
  try {
    fs.symlinkSync(outside, path.join(root, filename));
  } catch {
    t.skip("symlinks unavailable on this platform");
    return;
  }

  await assert.rejects(
    verifySavedPdf({
      root,
      filename,
      bytes: PDF.length,
      sha256: crypto.createHash("sha256").update(PDF).digest("hex"),
    }),
    errorCode("UNSAFE_EXISTING_FILE")
  );
});

test("sweepStaleTemps removes only stale strict-prefix files, including a hardlink temp", async (t) => {
  const root = tempRoot(t);
  const now = Date.now();
  const oldTime = new Date(now - DEFAULT_STALE_TEMP_AGE_MS - 60_000);
  const stalePartial = ".paperreader-zotero-101-aaaaaaaaaaaaaaaaaaaaaaaa.tmp";
  const staleHardlink = ".paperreader-zotero-102-bbbbbbbbbbbbbbbbbbbbbbbb.tmp";
  const fresh = ".paperreader-zotero-103-cccccccccccccccccccccccc.tmp";
  const unrelated = ".paperreader-zotero-104-too-short.tmp";
  const preservedPdf = "committed.pdf";

  fs.writeFileSync(path.join(root, stalePartial), "partial download");
  fs.utimesSync(path.join(root, stalePartial), oldTime, oldTime);
  fs.writeFileSync(path.join(root, preservedPdf), PDF);
  try {
    fs.linkSync(path.join(root, preservedPdf), path.join(root, staleHardlink));
  } catch {
    t.skip("hardlinks unavailable on this platform");
    return;
  }
  fs.utimesSync(path.join(root, staleHardlink), oldTime, oldTime);
  fs.writeFileSync(path.join(root, fresh), "active partial");
  fs.writeFileSync(path.join(root, unrelated), "unrelated");
  fs.utimesSync(path.join(root, unrelated), oldTime, oldTime);

  assert.deepStrictEqual(
    await sweepStaleTemps({ root, minAgeMs: DEFAULT_STALE_TEMP_AGE_MS, now }),
    { removed: 2, skipped: 1 }
  );
  assert.strictEqual(fs.existsSync(path.join(root, stalePartial)), false);
  assert.strictEqual(fs.existsSync(path.join(root, staleHardlink)), false);
  assert.deepStrictEqual(fs.readFileSync(path.join(root, preservedPdf)), PDF);
  assert.strictEqual(fs.existsSync(path.join(root, fresh)), true);
  assert.strictEqual(fs.existsSync(path.join(root, unrelated)), true);
});

test("sweepStaleTemps never removes a matching symlink", async (t) => {
  const root = tempRoot(t);
  const now = Date.now();
  const name = ".paperreader-zotero-105-dddddddddddddddddddddddd.tmp";
  const outside = path.join(os.tmpdir(), `paperreader-sweep-${crypto.randomBytes(8).toString("hex")}.tmp`);
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.writeFileSync(outside, "outside");
  try {
    fs.symlinkSync(outside, path.join(root, name));
  } catch {
    t.skip("symlinks unavailable on this platform");
    return;
  }

  assert.deepStrictEqual(
    await sweepStaleTemps({ root, minAgeMs: DEFAULT_STALE_TEMP_AGE_MS, now }),
    { removed: 0, skipped: 1 }
  );
  assert.ok(fs.lstatSync(path.join(root, name)).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(outside, "utf8"), "outside");
});

test("saveArxivPdf sweeps an old crash temp before starting a new download", async (t) => {
  const root = tempRoot(t);
  const stale = path.join(root, ".paperreader-zotero-106-eeeeeeeeeeeeeeeeeeeeeeee.tmp");
  fs.writeFileSync(stale, "crashed partial");
  const oldTime = new Date(Date.now() - DEFAULT_STALE_TEMP_AGE_MS - 60_000);
  fs.utimesSync(stale, oldTime, oldTime);

  const saved = await saveArxivPdf({ root, url: URL, fetchImpl: fetchBody() });
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(fs.existsSync(stale), false);
  assert.deepStrictEqual(tempFiles(root), []);
});
