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

  global.ZoteroClient = ZoteroClient;
  global.extractArxivId = extractArxivId;
  global.computeMd5 = computeMd5;
})(window);
