// Minimal Zotero Web API v3 client for the PaperReader desktop App.
// Covers credential checks, collection get/create, preprint and linked-file
// metadata, reconciliation, and deletion. Personal user libraries only.
// PDF bytes are committed to the configured OneDrive-backed linked attachment
// directory by the Electron main process before this client creates metadata.
//
// Docs: https://www.zotero.org/support/dev/web_api/v3/start

(function (global) {
  const API = "https://api.zotero.org";
  const REQUEST_TIMEOUT_MS = 60 * 1000;
  // A collection name is not provenance: users may already have their own
  // `Daily Paper` tree. Only items carrying this marker may be repaired or
  // removed by PaperReader. Unmarked matches remain visible as library
  // presence, but are always treated as user-owned/read-only.
  const PAPERREADER_MANAGED_TAG = "paperreader-managed-v1";

  class ZoteroClient {
    constructor(apiKey, userId) {
      this.apiKey = apiKey;
      this.userId = userId;
      this._collectionCreates = new Map();
      this.lastLibraryInventoryVersion = null;
      this._headers = {
        "Zotero-API-Key": apiKey,
        "Zotero-API-Version": "3",
        "Content-Type": "application/json",
      };
    }

    async _req(path, opts = {}) {
      const requestOptions = { ...opts };
      if (
        !requestOptions.signal &&
        global.AbortSignal &&
        typeof global.AbortSignal.timeout === "function"
      ) {
        requestOptions.signal = global.AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      }
      const res = await fetch(`${API}${path}`, {
        ...requestOptions,
        headers: { ...this._headers, ...(opts.headers || {}) },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const error = new Error(
          `Zotero ${opts.method || "GET"} ${path} → ${res.status}: ${text.slice(0, 200)}`
        );
        // Let callers distinguish a real HTTP response from a fetch-level
        // network failure. In particular, a 412 must not be retried as a new
        // create request.
        error.zoteroHttpStatus = res.status;
        throw error;
      }
      return res;
    }

    /**
     * POST one logical Zotero write. Zotero uses Zotero-Write-Token to make
     * retried creates idempotent, so the token is generated once and reused
     * if fetch itself fails before a response is received. HTTP failures are
     * responses from Zotero and are deliberately not retried here.
     */
    async _post(path, body) {
      const opts = {
        method: "POST",
        headers: { "Zotero-Write-Token": randomWriteToken() },
        body: JSON.stringify(body),
      };
      try {
        return await this._req(path, opts);
      } catch (error) {
        if (error && error.zoteroHttpStatus != null) throw error;
        return this._req(path, opts);
      }
    }

    /** Smoke-test the credentials. Throws on failure. */
    async verify() {
      await this._req(`/users/${this.userId}/items/top?limit=1`);
    }

    /** Return the monotonic personal-library version used for cache revalidation. */
    async getLibraryVersion() {
      const res = await this._req(
        `/users/${this.userId}/items/top?limit=1&format=versions`
      );
      const raw = res.headers.get("Last-Modified-Version");
      const version = Number(raw);
      return raw != null && raw !== "" && Number.isSafeInteger(version) && version >= 0
        ? version
        : null;
    }

    /**
     * Find the first collection named `name`. If `parentKey` is null, looks
     * among top-level collections; otherwise among children of `parentKey`.
     */
    async findCollection(name, parentKey) {
      const path = parentKey
        ? `/users/${this.userId}/collections/${parentKey}/collections`
        : `/users/${this.userId}/collections/top`;
      const list = await this._getAllPaged(path);
      const hit = list.find((c) => c.data && c.data.name === name);
      return hit ? hit.data.key : null;
    }

    async createCollection(name, parentKey) {
      const body = [{ name, parentCollection: parentKey || false }];
      const res = await this._post(`/users/${this.userId}/collections`, body);
      const data = await res.json();
      const success = data.successful && data.successful["0"];
      if (!success) {
        throw new Error(
          `create collection: no success entry. failed=${JSON.stringify(data.failed || {})}`
        );
      }
      return success.data.key;
    }

    getOrCreateCollection(name, parentKey = null) {
      const lockKey = `${parentKey || "__root__"}\u0000${name}`;
      const current = this._collectionCreates.get(lockKey);
      if (current) return current;
      const operation = (async () => {
        const existing = await this.findCollection(name, parentKey);
        if (existing) return existing;
        try {
          return await this.createCollection(name, parentKey);
        } catch (error) {
          // If the create response was lost, the idempotent retry can correctly
          // return 412 even though the collection now exists. Re-read before
          // surfacing the error so callers don't create a duplicate on retry.
          const committed = await this.findCollection(name, parentKey);
          if (committed) return committed;
          throw error;
        }
      })().finally(() => {
        if (this._collectionCreates.get(lockKey) === operation) {
          this._collectionCreates.delete(lockKey);
        }
      });
      this._collectionCreates.set(lockKey, operation);
      return operation;
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
        tags: [
          ...(paper.keywords || [])
            .map((t) => String(t).trim())
            .filter(Boolean)
            .filter((tag) => tag !== PAPERREADER_MANAGED_TAG)
            .map((tag) => ({ tag })),
          { tag: PAPERREADER_MANAGED_TAG },
        ],
      };

      try {
        const res = await this._post(`/users/${this.userId}/items`, [item]);
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
      } catch (error) {
        const committed = await this.findPreprintItem(paper, collectionKey).catch(() => null);
        if (committed) return committed.key || committed.data.key;
        throw error;
      }
    }

    async findPreprintItem(paper, collectionKey) {
      const target = baseArxivId(extractArxivId(paper && paper.url));
      if (!target) return null;
      const path = collectionKey
        ? `/users/${this.userId}/collections/${collectionKey}/items`
        : `/users/${this.userId}/items`;
      const items = await this._getAllPaged(path, { itemType: "preprint" });
      return (
        items.find((candidate) => {
          const data = candidate.data || {};
          return (
            baseArxivId(itemArxivId(data)) === target &&
            hasPaperReaderManagedTag(data)
          );
        }) || null
      );
    }

    /**
     * Create a linked-file child attachment. The path is interpreted by
     * Zotero (for example, "attachments:paper.pdf" when a linked attachment
     * base directory is configured); this request never uploads file bytes.
     *
     * Deliberately omit url/filename/md5/mtime: those fields describe linked
     * URLs or Zotero-managed storage files, not linked files.
     *
     * @param {string} parentKey
     * @param {{path: string, title?: string, contentType?: string}} fileMeta
     * @returns {Promise<string>} attachment item key
     */
    async createLinkedFileAttachment(parentKey, fileMeta) {
      if (!fileMeta || !fileMeta.path) {
        throw new Error("create linked-file attachment: path is required");
      }
      const item = {
        itemType: "attachment",
        parentItem: parentKey,
        linkMode: "linked_file",
        title: fileMeta.title || "Full Text PDF",
        path: fileMeta.path,
        contentType: fileMeta.contentType || "application/pdf",
      };
      const res = await this._post(`/users/${this.userId}/items`, [item]);
      const data = await res.json();
      if (data.failed && Object.keys(data.failed).length) {
        const failed = Object.values(data.failed)[0];
        throw new Error(
          `create linked-file attachment failed: ${failed.message || JSON.stringify(failed)}`
        );
      }
      const success = data.successful && data.successful["0"];
      if (!success) throw new Error("create linked-file attachment: no success entry");
      return success.data.key;
    }

    /** Return all child attachment items, preserving the Web API envelope. */
    async listChildAttachments(parentKey) {
      const items = await this._getAllPaged(
        `/users/${this.userId}/items/${parentKey}/children`,
        { itemType: "attachment" }
      );
      // Keep this defensive filter for mocked/older endpoints that may ignore
      // itemType. Callers always receive attachment items only.
      return items.filter((item) => item && item.data && item.data.itemType === "attachment");
    }

    /**
     * Find the first linked-file child. If path is provided it must match
     * data.path exactly. Returns the original Web API item object or null.
     */
    async findLinkedFileAttachment(parentKey, path = null) {
      const items = await this.listChildAttachments(parentKey);
      return (
        items.find((item) => {
          const data = item.data || {};
          return (
            data.linkMode === "linked_file" &&
            (path == null || data.path === path)
          );
        }) || null
      );
    }

    async deleteItem(itemKey) {
      // DELETE requires If-Unmodified-Since-Version, so fetch current version first.
      let getRes;
      try {
        getRes = await this._req(`/users/${this.userId}/items/${itemKey}`);
      } catch (error) {
        // Retrying a delete after a lost successful response starts here. A
        // missing item is the desired postcondition, not a new failure.
        if (error && error.zoteroHttpStatus === 404) return;
        throw error;
      }
      const data = await getRes.json();
      const version = data.version;
      try {
        await this._req(`/users/${this.userId}/items/${itemKey}`, {
          method: "DELETE",
          headers: { "If-Unmodified-Since-Version": String(version) },
        });
      } catch (error) {
        if (error && error.zoteroHttpStatus === 404) return;
        // The response may have been lost after Zotero committed the delete.
        // Re-read once; only suppress the original error when absence proves
        // that the intended postcondition was reached.
        try {
          await this._req(`/users/${this.userId}/items/${itemKey}`);
        } catch (checkError) {
          if (checkError && checkError.zoteroHttpStatus === 404) return;
        }
        throw error;
      }
    }

    // ---- read-only reconcile: which Daily Paper items are already added ----

    // GET a list endpoint with full pagination (Zotero caps page size at 100).
    async _getAllPagedResult(path, params = {}) {
      const limit = 100;
      let start = 0;
      let out = [];
      const libraryVersions = [];
      for (;;) {
        const qs = new URLSearchParams({
          ...params,
          limit: String(limit),
          start: String(start),
        });
        const res = await this._req(`${path}?${qs.toString()}`);
        const rawVersion = res.headers.get("Last-Modified-Version");
        const libraryVersion = Number(rawVersion);
        if (
          rawVersion != null &&
          rawVersion !== "" &&
          Number.isSafeInteger(libraryVersion) &&
          libraryVersion >= 0
        ) {
          libraryVersions.push(libraryVersion);
        }
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        out = out.concat(batch);
        const total = parseInt(res.headers.get("Total-Results") || "0", 10);
        start += batch.length;
        if (batch.length < limit || (total && out.length >= total)) break;
      }
      return { items: out, libraryVersions };
    }

    async _getAllPaged(path, params = {}) {
      return (await this._getAllPagedResult(path, params)).items;
    }

    /**
     * Build { baseArxivId: itemKey } for every preprint already filed under the
     * `Daily Paper` collection tree. Read-only: if the root collection doesn't
     * exist yet (nothing ever added), returns {} without creating anything.
     */
    async listDailyPaperArxivKeysMap(rootName) {
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
        if (!hasPaperReaderManagedTag(d)) continue;
        const base = baseArxivId(itemArxivId(d));
        if (!base || !it.key) continue;
        if (!map[base]) map[base] = [];
        if (!map[base].includes(it.key)) map[base].push(it.key);
      }
      return map;
    }

    async listDailyPaperArxivMap(rootName) {
      const keysById = await this.listDailyPaperArxivKeysMap(rootName);
      const map = {};
      for (const [base, keys] of Object.entries(keysById)) {
        if (Array.isArray(keys) && keys.length) map[base] = keys[0];
      }
      return map;
    }

    /**
     * Build a read-only inventory of every arXiv parent item in the personal
     * library while keeping PaperReader's mutation boundary explicit.
     *
     * `libraryKeys` contains matching top-level items of any Zotero item type
     * and in any collection. `managedKeys` is deliberately narrower: only
     * preprints filed in the requested PaperReader collection subtree. Callers
     * can therefore show honest whole-library presence without treating an
     * arbitrary user-owned item as safe to delete.
     *
     * Collections and top-level items are independent reads, so fetch both in
     * parallel. Each endpoint still uses the normal full-pagination helper.
     */
    async listLibraryArxivInventory(rootName, retry = 0) {
      const [collectionResult, itemResult] = await Promise.all([
        this._getAllPagedResult(`/users/${this.userId}/collections`),
        this._getAllPagedResult(`/users/${this.userId}/items/top`),
      ]);
      const collections = collectionResult.items;
      const items = itemResult.items;
      const versions = [
        ...collectionResult.libraryVersions,
        ...itemResult.libraryVersions,
      ];
      const distinctVersions = new Set(versions);
      // Pagination is not a server-side snapshot. If Zotero changed while the
      // pages were being read, retry once so shifted pages cannot silently omit
      // or duplicate a record in the presence index.
      if (distinctVersions.size > 1) {
        if (retry < 1) {
          return this.listLibraryArxivInventory(rootName, retry + 1);
        }
        const error = new Error(
          "Zotero 库正在同步，暂时无法建立一致索引，请稍后重试"
        );
        error.code = "ZOTERO_INVENTORY_UNSTABLE";
        throw error;
      }
      this.lastLibraryInventoryVersion = versions.length
        ? Math.max(...versions)
        : null;

      const rootKeys = (collections || [])
        .filter((collection) => {
          const data = (collection && collection.data) || {};
          return data.name === rootName && !data.parentCollection;
        })
        .map((collection) => collection.key || (collection.data && collection.data.key))
        .filter(Boolean);
      const managedTreeKeys = new Set();
      for (const rootKey of rootKeys) {
        for (const key of subtreeKeys(collections, rootKey)) managedTreeKeys.add(key);
      }

      const inventory = {};
      for (const item of items || []) {
        const data = (item && item.data) || {};
        // `/items/top` can also contain standalone files and notes. They are
        // not bibliographic parent items and must not make a paper look bound
        // merely because a filename/note happens to contain an arXiv ID.
        if (["attachment", "note", "annotation"].includes(data.itemType)) continue;
        const itemKey = item && (item.key || data.key);
        const baseId = baseArxivId(itemArxivId(data));
        if (!itemKey || !baseId) continue;
        const normalizedId = String(baseId).toLowerCase();
        if (!inventory[normalizedId]) {
          inventory[normalizedId] = { libraryKeys: [], managedKeys: [] };
        }
        const entry = inventory[normalizedId];
        if (!entry.libraryKeys.includes(itemKey)) entry.libraryKeys.push(itemKey);

        const itemCollections = Array.isArray(data.collections) ? data.collections : [];
        const isManaged =
          data.itemType === "preprint" &&
          hasPaperReaderManagedTag(data) &&
          itemCollections.some((collectionKey) => managedTreeKeys.has(collectionKey));
        if (isManaged && !entry.managedKeys.includes(itemKey)) {
          entry.managedKeys.push(itemKey);
        }
      }
      return inventory;
    }

    /** Revalidate the narrow deletion boundary immediately before a mutation. */
    async isItemManagedInCollectionTree(itemKey, rootName, expectedBaseId) {
      if (!/^[A-Z0-9]{8}$/i.test(itemKey || "")) return false;
      const itemRequest = this._req(`/users/${this.userId}/items/${itemKey}`)
        .then((res) => res.json())
        .catch((error) => {
          if (error && error.zoteroHttpStatus === 404) return null;
          throw error;
        });
      const [collections, item] = await Promise.all([
        this._getAllPaged(`/users/${this.userId}/collections`),
        itemRequest,
      ]);
      if (!item) return false;
      const rootKeys = (collections || [])
        .filter((collection) => {
          const data = (collection && collection.data) || {};
          return data.name === rootName && !data.parentCollection;
        })
        .map((collection) => collection.key || (collection.data && collection.data.key))
        .filter(Boolean);
      const managedTreeKeys = new Set();
      for (const rootKey of rootKeys) {
        for (const key of subtreeKeys(collections, rootKey)) managedTreeKeys.add(key);
      }
      const data = item.data || {};
      const itemCollections = Array.isArray(data.collections) ? data.collections : [];
      const actualBaseId = baseArxivId(itemArxivId(data));
      const identityMatches =
        !expectedBaseId ||
        (actualBaseId &&
          String(actualBaseId).toLowerCase() === String(expectedBaseId).toLowerCase());
      return (
        data.itemType === "preprint" &&
        hasPaperReaderManagedTag(data) &&
        identityMatches &&
        itemCollections.some((collectionKey) => managedTreeKeys.has(collectionKey))
      );
    }
  }

  /** Generate the 32-character idempotency token expected by Zotero writes. */
  function randomWriteToken() {
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const bytes = new Uint8Array(32);
    const cryptoObject = global.crypto;
    if (cryptoObject && typeof cryptoObject.getRandomValues === "function") {
      cryptoObject.getRandomValues(bytes);
    } else {
      // Older/non-secure browser contexts may not expose Web Crypto. A write
      // token is an idempotency nonce rather than a secret, so Math.random is
      // a safe compatibility fallback here.
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    let token = "";
    for (let i = 0; i < bytes.length; i += 1) {
      token += alphabet[bytes[i] % alphabet.length];
    }
    return token;
  }

  /** Pull an ID only from a canonical arxiv.org URL (never a lookalike host). */
  function extractArxivId(url) {
    if (!url) return null;
    const m = String(url).trim().match(
      /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?)(?:\.pdf)?(?:[/?#].*)?$/i
    );
    return m ? m[1] : null;
  }

  /** Find a canonical arxiv.org URL embedded in a multi-line Extra field. */
  function arxivIdFromTextUrl(value) {
    if (!value) return null;
    const m = String(value).match(
      /(?:^|[\s(])https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?)(?:\.pdf)?(?=$|[/?#\s)])/i
    );
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
      const value = String(d.archiveID).trim();
      const idPattern =
        "((?:\\d{4}\\.\\d{4,5}|[a-z][a-z0-9.-]*\\/\\d{7})(?:v\\d+)?)";
      const prefixed = value.match(
        new RegExp(`^arxiv(?:\\.org)?(?:\\s+id)?\\s*[:=]\\s*${idPattern}$`, "i")
      );
      if (prefixed) return prefixed[1];
      const context = `${d.repository || ""} ${d.libraryCatalog || ""}`;
      const bare = value.match(new RegExp(`^${idPattern}$`, "i"));
      if (bare && /\barxiv(?:\.org)?\b/i.test(context)) return bare[1];
    }
    if (d.DOI) {
      const doi = String(d.DOI).trim().match(
        /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\.((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?)$/i
      );
      if (doi) return doi[1];
    }
    if (d.url) {
      const x = extractArxivId(d.url);
      if (x) return x;
    }
    if (d.extra) {
      const value = String(d.extra);
      const urlId = arxivIdFromTextUrl(value);
      if (urlId) return urlId;
      const current = value.match(
        /\barxiv(?:\s+id)?\s*[:=]\s*(\d{4}\.\d{4,5})(v\d+)?/i
      );
      if (current) return current[1] + (current[2] || "");
      const old = value.match(
        /\barxiv(?:\s+id)?\s*[:=]\s*([a-z][a-z0-9.-]*\/\d{7})(v\d+)?/i
      );
      if (old) return old[1] + (old[2] || "");
      const doi = value.match(
        /10\.48550\/arxiv\.((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?)/i
      );
      if (doi) return doi[1];
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

  function hasPaperReaderManagedTag(data) {
    const tags = data && Array.isArray(data.tags) ? data.tags : [];
    return tags.some((entry) => {
      const value = typeof entry === "string" ? entry : entry && entry.tag;
      return value === PAPERREADER_MANAGED_TAG;
    });
  }

  global.ZoteroClient = ZoteroClient;
  global.extractArxivId = extractArxivId;
  global.baseArxivId = baseArxivId;
  global.PAPERREADER_MANAGED_TAG = PAPERREADER_MANAGED_TAG;
  global.ZOTERO_REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
})(window);
