// Minimal Zotero Web API v3 client tailored for the daily-paper site.
// Covers: credential check, collection get/create, item create with
// linked-URL or imported_url attachments, item delete. Personal user
// libraries only.
//
// File bytes are NOT uploaded via this client — for WebDAV-backed Zotero
// libraries, the bytes are PUT directly to the user's WebDAV server
// (see js/webdav.js). This client just sets the metadata (md5/mtime/
// filename) on the imported_url attachment so that desktop sync recognizes
// the WebDAV file when it appears.
//
// Docs: https://www.zotero.org/support/dev/web_api/v3/start

(function (global) {
  const API = "https://api.zotero.org";

  class ZoteroClient {
    constructor(apiKey, userId) {
      this.apiKey = apiKey;
      this.userId = userId;
      this._headers = {
        "Zotero-API-Key": apiKey,
        "Zotero-API-Version": "3",
        "Content-Type": "application/json",
      };
    }

    async _req(path, opts = {}) {
      const res = await fetch(`${API}${path}`, {
        ...opts,
        headers: { ...this._headers, ...(opts.headers || {}) },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Zotero ${opts.method || "GET"} ${path} → ${res.status}: ${text.slice(0, 200)}`
        );
      }
      return res;
    }

    /** Smoke-test the credentials. Throws on failure. */
    async verify() {
      await this._req(`/users/${this.userId}/items/top?limit=1`);
    }

    /**
     * Find the first collection named `name`. If `parentKey` is null, looks
     * among top-level collections; otherwise among children of `parentKey`.
     */
    async findCollection(name, parentKey) {
      const path = parentKey
        ? `/users/${this.userId}/collections/${parentKey}/collections`
        : `/users/${this.userId}/collections/top`;
      const res = await this._req(`${path}?limit=100`);
      const list = await res.json();
      const hit = list.find((c) => c.data && c.data.name === name);
      return hit ? hit.data.key : null;
    }

    async createCollection(name, parentKey) {
      const body = [{ name, parentCollection: parentKey || false }];
      const res = await this._req(`/users/${this.userId}/collections`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const success = data.successful && data.successful["0"];
      if (!success) {
        throw new Error(
          `create collection: no success entry. failed=${JSON.stringify(data.failed || {})}`
        );
      }
      return success.data.key;
    }

    async getOrCreateCollection(name, parentKey = null) {
      const existing = await this.findCollection(name, parentKey);
      if (existing) return existing;
      return this.createCollection(name, parentKey);
    }

    /**
     * Create a Zotero "preprint" item from arxiv metadata.
     * @param {{title, summary, url, authors, keywords?}} paper
     * @param {string} collectionKey  parent collection
     * @returns {Promise<string>}  the new item key
     */
    async createPreprintItem(paper, collectionKey) {
      const arxivId = extractArxivId(paper.url);
      const cleanArxivId = arxivId ? arxivId.replace(/v\d+$/i, "") : "";
      const item = {
        itemType: "preprint",
        title: paper.title || "",
        abstractNote: paper.summary || "",
        creators: (paper.authors || []).map((name) => ({
          creatorType: "author",
          name: String(name),
        })),
        url: paper.url || "",
        repository: "arXiv",
        archiveID: arxivId || "",
        libraryCatalog: "arXiv.org",
        DOI: cleanArxivId ? `10.48550/arXiv.${cleanArxivId}` : "",
        collections: collectionKey ? [collectionKey] : [],
        tags: (paper.keywords || []).map((t) => ({ tag: String(t) })),
      };

      const res = await this._req(`/users/${this.userId}/items`, {
        method: "POST",
        body: JSON.stringify([item]),
      });
      const data = await res.json();
      if (data.failed && Object.keys(data.failed).length) {
        const failed = Object.values(data.failed)[0];
        throw new Error(
          `create item failed: ${failed.message || JSON.stringify(failed)}`
        );
      }
      const success = data.successful && data.successful["0"];
      if (!success) throw new Error("create item: no success entry returned");
      return success.data.key;
    }

    /**
     * Create an imported_url attachment item. For the WebDAV upload flow we
     * MUST set md5/mtime/filename upfront — desktop sync compares these
     * against the file it pulls from WebDAV to verify integrity.
     *
     * For Web-API file upload (NOT used here) you'd omit md5/mtime,
     * otherwise authorizeUpload returns 412.
     *
     * @param {string} parentKey
     * @param {{title?, url, filename, contentType?, md5, mtime}} fileMeta
     * @returns {Promise<string>}  attachment item key
     */
    async createImportedAttachment(parentKey, fileMeta) {
      const item = {
        itemType: "attachment",
        parentItem: parentKey,
        linkMode: "imported_url",
        title: fileMeta.title || "Full Text PDF",
        url: fileMeta.url || "",
        filename: fileMeta.filename,
        contentType: fileMeta.contentType || "application/pdf",
        charset: "",
        md5: fileMeta.md5,
        mtime: fileMeta.mtime,
      };
      const res = await this._req(`/users/${this.userId}/items`, {
        method: "POST",
        body: JSON.stringify([item]),
      });
      const data = await res.json();
      if (data.failed && Object.keys(data.failed).length) {
        const failed = Object.values(data.failed)[0];
        throw new Error(
          `create attachment failed: ${failed.message || JSON.stringify(failed)}`
        );
      }
      const success = data.successful && data.successful["0"];
      if (!success) throw new Error("create attachment: no success entry");
      return success.data.key;
    }

    /**
     * Add a child attachment that just stores a URL — no file payload.
     * Used as a fallback when WebDAV upload isn't configured or fails.
     */
    async addLinkedAttachment(parentKey, url, title = "Full Text PDF") {
      const attachment = {
        itemType: "attachment",
        parentItem: parentKey,
        linkMode: "linked_url",
        title,
        url,
        contentType: "application/pdf",
      };
      const res = await this._req(`/users/${this.userId}/items`, {
        method: "POST",
        body: JSON.stringify([attachment]),
      });
      const data = await res.json();
      if (data.failed && Object.keys(data.failed).length) {
        const failed = Object.values(data.failed)[0];
        throw new Error(
          `attach failed: ${failed.message || JSON.stringify(failed)}`
        );
      }
    }

    async deleteItem(itemKey) {
      // DELETE requires If-Unmodified-Since-Version, so fetch current version first.
      const getRes = await this._req(`/users/${this.userId}/items/${itemKey}`);
      const data = await getRes.json();
      const version = data.version;
      await this._req(`/users/${this.userId}/items/${itemKey}`, {
        method: "DELETE",
        headers: { "If-Unmodified-Since-Version": String(version) },
      });
    }

    // ---- read-only reconcile: which Daily Paper items are already added ----

    // GET a list endpoint with full pagination (Zotero caps page size at 100).
    async _getAllPaged(path, params = {}) {
      const limit = 100;
      let start = 0;
      let out = [];
      for (;;) {
        const qs = new URLSearchParams({
          ...params,
          limit: String(limit),
          start: String(start),
        });
        const res = await this._req(`${path}?${qs.toString()}`);
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        out = out.concat(batch);
        const total = parseInt(res.headers.get("Total-Results") || "0", 10);
        start += batch.length;
        if (batch.length < limit || (total && out.length >= total)) break;
      }
      return out;
    }

    /**
     * Build { baseArxivId: itemKey } for every preprint already filed under the
     * `Daily Paper` collection tree. Read-only: if the root collection doesn't
     * exist yet (nothing ever added), returns {} without creating anything.
     */
    async listDailyPaperArxivMap(rootName) {
      const rootKey = await this.findCollection(rootName, null);
      if (!rootKey) return {};
      const collections = await this._getAllPaged(`/users/${this.userId}/collections`);
      const treeKeys = subtreeKeys(collections, rootKey);
      const items = await this._getAllPaged(`/users/${this.userId}/items`, {
        itemType: "preprint",
      });
      const map = {};
      for (const it of items) {
        const d = it.data || {};
        const cols = Array.isArray(d.collections) ? d.collections : [];
        if (!cols.some((k) => treeKeys.has(k))) continue;
        const base = baseArxivId(itemArxivId(d));
        if (base && !map[base]) map[base] = it.key;
      }
      return map;
    }
  }

  /**
   * Compute the lower-case hex MD5 of the given bytes. Uses SparkMD5 loaded
   * from CDN (template imports it as a global). Throws if SparkMD5 missing.
   * Browser SubtleCrypto can't help — Zotero's WebDAV format requires MD5.
   *
   * Accepts ArrayBuffer or Uint8Array.
   */
  function computeMd5(bytes) {
    if (typeof SparkMD5 === "undefined") {
      throw new Error("SparkMD5 not loaded — check the CDN script in template");
    }
    const buf = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
    const spark = new SparkMD5.ArrayBuffer();
    spark.append(buf);
    return spark.end(); // hex string, lower-case
  }

  /** Pull "2604.25459v1" out of "http://arxiv.org/abs/2604.25459v1". */
  function extractArxivId(url) {
    if (!url) return null;
    const m = url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:\.pdf)?$/i);
    return m ? m[1] : null;
  }

  /** Strip the trailing version: "2606.13675v1" → "2606.13675". */
  function baseArxivId(id) {
    return id ? String(id).replace(/v\d+$/i, "") : null;
  }

  /** Best-effort arxiv id (with version, if present) from a Zotero item's data. */
  function itemArxivId(d) {
    if (!d) return null;
    if (d.archiveID) {
      const m = String(d.archiveID).match(/(\d{4}\.\d{4,5})(v\d+)?/i);
      if (m) return m[1] + (m[2] || "");
      return String(d.archiveID);
    }
    if (d.DOI) {
      const m = String(d.DOI).match(/arXiv\.(\d{4}\.\d{4,5})(v\d+)?/i);
      if (m) return m[1] + (m[2] || "");
    }
    if (d.url) {
      const x = extractArxivId(d.url);
      if (x) return x;
    }
    return null;
  }

  /** Set of collection keys in the subtree rooted at rootKey (inclusive). */
  function subtreeKeys(collections, rootKey) {
    const childrenOf = new Map();
    for (const c of collections || []) {
      const key = c.key || (c.data && c.data.key);
      const parent = (c.data && c.data.parentCollection) || "__root__";
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(key);
    }
    const set = new Set([rootKey]);
    const stack = [rootKey];
    while (stack.length) {
      const cur = stack.pop();
      for (const k of childrenOf.get(cur) || []) {
        if (k && !set.has(k)) {
          set.add(k);
          stack.push(k);
        }
      }
    }
    return set;
  }

  global.ZoteroClient = ZoteroClient;
  global.extractArxivId = extractArxivId;
  global.baseArxivId = baseArxivId;
  global.computeMd5 = computeMd5;
})(window);
