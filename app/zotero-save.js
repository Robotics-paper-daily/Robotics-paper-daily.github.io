// App-side Zotero "save a paper" core, shared by the report iframe, search
// panel, and read-modal. Zotero Web API owns collections/item metadata; the
// privileged Electron bridge downloads the PDF into Zotero's OneDrive-backed
// Linked Attachment Base Directory and returns an `attachments:` path.
//
// Requires js/zotero.js (ZoteroClient, extractArxivId, baseArxivId). Callers
// own their UI; this module never falls back to a linked URL and never reports
// success until both the local file and linked-file metadata are present.
(function (global) {
  const ROOT_COLLECTION_NAME = "Daily Paper";
  const ADDED_MAP_TTL_MS = 5 * 60 * 1000;

  function canonicalPaper(paper) {
    const source = (paper && paper.url) || "";
    const normalized = source.replace(/^http:\/\//i, "https://");
    const arxivId = extractArxivId(normalized);
    if (!arxivId) throw new Error("无法识别 arXiv ID，不能创建本地链接附件");
    return {
      arxivId,
      baseId: String(baseArxivId(arxivId) || arxivId).toLowerCase(),
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    };
  }

  function collectionDate(paper) {
    const candidate = String((paper && (paper.date || paper.published)) || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
    return new Date().toLocaleDateString("sv"); // YYYY-MM-DD
  }

  function linkedFileResult(item) {
    const data = (item && item.data) || {};
    return {
      ok: true,
      storage: "linked-file",
      state: "existing",
      zoteroPath: data.path || "",
      attachmentKey: item && (item.key || data.key),
    };
  }

  class Saver {
    constructor(client, bridge) {
      this.client = client;
      this.bridge = bridge || null;
      this._addedMap = null;
      this._addedMapPromise = null;
      this._addedMapLoadedAt = 0;
      this._libraryInventory = null;
      this._libraryInventoryPromise = null;
      this._libraryInventoryLoadedAt = 0;
      this._libraryInventoryVersion = null;
      this._inFlight = new Map();
    }

    async _collectionFor(paper) {
      const rootKey = await this.client.getOrCreateCollection(ROOT_COLLECTION_NAME);
      return this.client.getOrCreateCollection(collectionDate(paper), rootKey);
    }

    async _loadAddedMap(force = false) {
      if (
        !force &&
        this._libraryInventory &&
        Date.now() - this._libraryInventoryLoadedAt < ADDED_MAP_TTL_MS
      ) {
        return this._addedMap || {};
      }
      if (
        !force &&
        this._addedMap &&
        Date.now() - this._addedMapLoadedAt < ADDED_MAP_TTL_MS
      ) {
        return this._addedMap;
      }
      if (!this._addedMapPromise) {
        const load =
          typeof this.client.listDailyPaperArxivKeysMap === "function"
            ? this.client.listDailyPaperArxivKeysMap(ROOT_COLLECTION_NAME)
            : this.client.listDailyPaperArxivMap(ROOT_COLLECTION_NAME);
        this._addedMapPromise = Promise.resolve(load)
          .then((map) => {
            const normalized = {};
            for (const [id, value] of Object.entries(map || {})) {
              const keys = Array.isArray(value) ? value : [value];
              normalized[String(id).toLowerCase()] = [
                ...new Set(keys.filter((key) => typeof key === "string" && key)),
              ];
            }
            this._addedMap = normalized;
            this._addedMapLoadedAt = Date.now();
            return normalized;
          })
          .finally(() => {
            this._addedMapPromise = null;
          });
      }
      return this._addedMapPromise;
    }

    /**
     * Load a presence index for every recognizable arXiv item in the personal
     * library while keeping the much narrower App-managed/removable set
     * explicit. Reinstalling the App must restore "In Zotero" state for items
     * outside Daily Paper (or with a legacy item type), but those items must
     * never silently become deletion targets.
     */
    async _loadLibraryInventory(force = false) {
      if (
        !force &&
        this._libraryInventory &&
        Date.now() - this._libraryInventoryLoadedAt < ADDED_MAP_TTL_MS
      ) {
        return this._libraryInventory;
      }
      if (!this._libraryInventoryPromise) {
        const supportsInventory =
          typeof this.client.listLibraryArxivInventory === "function";
        const load = supportsInventory
          ? this.client.listLibraryArxivInventory(ROOT_COLLECTION_NAME)
          : this._loadAddedMap(force).then((managedMap) => {
              const compatibility = {};
              for (const [id, keys] of Object.entries(managedMap || {})) {
                compatibility[id] = { libraryKeys: keys, managedKeys: keys };
              }
              return compatibility;
            });
        this._libraryInventoryPromise = Promise.resolve(load)
          .then((inventory) => {
            const normalized = {};
            const managedMap = {};
            for (const [id, value] of Object.entries(inventory || {})) {
              const descriptor = value && typeof value === "object" ? value : {};
              const managedKeys = [
                ...new Set(
                  (Array.isArray(descriptor.managedKeys) ? descriptor.managedKeys : [])
                    .filter((key) => typeof key === "string" && key)
                ),
              ];
              const libraryKeys = [
                ...new Set(
                  [
                    ...(Array.isArray(descriptor.libraryKeys) ? descriptor.libraryKeys : []),
                    ...managedKeys,
                  ].filter((key) => typeof key === "string" && key)
                ),
              ];
              if (!libraryKeys.length) continue;
              const baseId = String(id).toLowerCase();
              normalized[baseId] = { libraryKeys, managedKeys };
              if (managedKeys.length) managedMap[baseId] = managedKeys;
            }
            this._libraryInventory = normalized;
            this._libraryInventoryLoadedAt = Date.now();
            this._libraryInventoryVersion = Number.isSafeInteger(
              this.client.lastLibraryInventoryVersion
            )
              ? this.client.lastLibraryInventoryVersion
              : null;
            this._addedMap = managedMap;
            this._addedMapLoadedAt = this._libraryInventoryLoadedAt;
            return normalized;
          })
          .finally(() => {
            this._libraryInventoryPromise = null;
          });
      }
      return this._libraryInventoryPromise;
    }

    /**
     * A five-minute presence cache keeps report navigation fast, but a write
     * must not trust it blindly. Zotero's library version makes the common
     * unchanged case one lightweight request while forcing a complete rebuild
     * whenever the user changed their library in Zotero itself.
     */
    async _loadMutationInventory() {
      // The first mutation always starts from a fresh snapshot. More
      // importantly, a missing/invalid version must fail closed: App writes
      // deliberately clear `_libraryInventoryVersion`, so trusting the
      // remaining five-minute inventory here would make the next mutation use
      // stale authorization and duplicate-detection state.
      if (!this._libraryInventory) {
        return this._loadLibraryInventory(true);
      }
      if (
        typeof this.client.getLibraryVersion !== "function" ||
        !Number.isSafeInteger(this._libraryInventoryVersion)
      ) {
        return this._loadLibraryInventory(true);
      }
      const currentVersion = await this.client.getLibraryVersion();
      if (
        Number.isSafeInteger(currentVersion) &&
        currentVersion === this._libraryInventoryVersion
      ) {
        return this._libraryInventory;
      }
      return this._loadLibraryInventory(true);
    }

    async _resolveInventoryMatch(inventory, identity) {
      const match = inventory[identity.baseId] || {
        libraryKeys: [],
        managedKeys: [],
      };
      const candidates = match.managedKeys || [];
      const itemKey = candidates[0] || null;

      if (!itemKey && match.libraryKeys && match.libraryKeys.length) {
        return {
          itemKey: null,
          outcome: {
            ok: true,
            status: "already-in-library",
            itemKey: match.libraryKeys[0],
            managed: false,
            libraryMatch: true,
          },
        };
      }

      for (const candidateKey of candidates) {
        const existing = await this._findAnyLinkedPdf(candidateKey);
        if (existing) {
          return {
            itemKey: candidateKey,
            outcome: {
              ok: true,
              status: "already-added",
              itemKey: candidateKey,
              managed: true,
              pdf: linkedFileResult(existing),
            },
          };
        }
      }
      return { itemKey, outcome: null };
    }

    async _writePdf(pdfUrl) {
      if (!this.bridge || typeof this.bridge.zoteroWriteLinkedPdf !== "function") {
        throw new Error("当前 App 不支持本地 Zotero 链接附件，请升级或重启 App");
      }
      const result = await this.bridge.zoteroWriteLinkedPdf({ sourceUrl: pdfUrl });
      if (!result || !result.ok) {
        throw new Error((result && result.reason) || "PDF 写入 OneDrive 失败");
      }
      if (result.cloudConfirmed !== true) {
        throw new Error("OneDrive 尚未确认云端提交，已停止创建 Zotero 元数据");
      }
      if (!/^attachments:[^/\\]+$/i.test(result.zoteroPath || "")) {
        throw new Error("App 返回了无效的 Zotero 相对附件路径");
      }
      return result;
    }

    async _findAnyLinkedPdf(parentKey) {
      const children = await this.client.listChildAttachments(parentKey);
      return (
        children.find((item) => {
          const data = item.data || {};
          return (
            data.linkMode === "linked_file" &&
            /^attachments:[^/\\]+$/i.test(data.path || "") &&
            /\.pdf$/i.test(data.path || "") &&
            (!data.contentType || data.contentType === "application/pdf")
          );
        }) || null
      );
    }

    async _ensureLinkedAttachment(parentKey, file) {
      let attachment = await this.client.findLinkedFileAttachment(parentKey, file.zoteroPath);
      if (!attachment) {
        try {
          await this.client.createLinkedFileAttachment(parentKey, {
            path: file.zoteroPath,
            title: "Full Text PDF",
            contentType: "application/pdf",
          });
        } catch (error) {
          // A lost response or a reused write token can surface as an error even
          // though Zotero committed the create. Re-query before declaring failure.
          attachment = await this.client.findLinkedFileAttachment(parentKey, file.zoteroPath);
          if (!attachment) throw error;
        }
      }
      attachment =
        attachment || (await this.client.findLinkedFileAttachment(parentKey, file.zoteroPath));
      const data = (attachment && attachment.data) || {};
      if (
        !attachment ||
        data.parentItem !== parentKey ||
        data.linkMode !== "linked_file" ||
        data.path !== file.zoteroPath
      ) {
        throw new Error("Zotero linked-file 元数据反查失败，请重试");
      }
      return attachment;
    }

    async _add(paper, identity) {
      let inventory = await this._loadMutationInventory();
      let resolved = await this._resolveInventoryMatch(inventory, identity);
      if (resolved.outcome) return resolved.outcome;
      let itemKey = resolved.itemKey;

      // Download and atomically commit the file before creating new metadata,
      // so a failed download never leaves a new empty Zotero parent item.
      const file = await this._writePdf(identity.pdfUrl);

      // OneDrive confirmation can take minutes. Zotero may have changed while
      // the file was being committed, so revalidate the whole-library presence
      // and the narrow managed set again before any parent/attachment POST.
      inventory = await this._loadMutationInventory();
      resolved = await this._resolveInventoryMatch(inventory, identity);
      if (resolved.outcome) return resolved.outcome;
      itemKey = resolved.itemKey;

      if (
        itemKey &&
        typeof this.client.isItemManagedInCollectionTree === "function" &&
        !(await this.client.isItemManagedInCollectionTree(
          itemKey,
          ROOT_COLLECTION_NAME,
          identity.baseId
        ))
      ) {
        // The item moved or changed after the inventory read. Refresh once and
        // resolve its current state; if it is still reported as managed but
        // fails the live check, stop instead of attaching to an ambiguous item.
        inventory = await this._loadLibraryInventory(true);
        resolved = await this._resolveInventoryMatch(inventory, identity);
        if (resolved.outcome) return resolved.outcome;
        itemKey = resolved.itemKey;
        if (
          itemKey &&
          !(await this.client.isItemManagedInCollectionTree(
            itemKey,
            ROOT_COLLECTION_NAME,
            identity.baseId
          ))
        ) {
          throw new Error("Zotero 条目在写入期间发生变化，已停止创建附件");
        }
      }

      let repaired = !!itemKey;
      if (!itemKey) {
        const collectionKey = await this._collectionFor(paper);

        // Collection creation itself advances the library version. Force one
        // final source-of-truth scan immediately before creating the parent so
        // an item added concurrently in Zotero is reused instead of duplicated.
        inventory = await this._loadLibraryInventory(true);
        resolved = await this._resolveInventoryMatch(inventory, identity);
        if (resolved.outcome) return resolved.outcome;
        itemKey = resolved.itemKey;
        repaired = !!itemKey;

        if (
          itemKey &&
          typeof this.client.isItemManagedInCollectionTree === "function" &&
          !(await this.client.isItemManagedInCollectionTree(
            itemKey,
            ROOT_COLLECTION_NAME,
            identity.baseId
          ))
        ) {
          throw new Error("Zotero 条目在写入期间发生变化，已停止创建附件");
        }

        if (!itemKey) {
          try {
            itemKey = await this.client.createPreprintItem(paper, collectionKey);
          } catch (error) {
            // As with attachments, a lost successful response may become a 412
            // on the idempotent retry. Refresh the source-of-truth map before
            // deciding the parent creation really failed.
            this._addedMap = null;
            this._addedMapLoadedAt = 0;
            this._libraryInventory = null;
            this._libraryInventoryLoadedAt = 0;
            this._libraryInventoryVersion = null;
            const refreshed = await this._loadLibraryInventory(true);
            itemKey =
              (refreshed[identity.baseId] &&
                refreshed[identity.baseId].managedKeys[0]) ||
              null;
            if (!itemKey) throw error;
            repaired = true;
          }
          (this._addedMap || (this._addedMap = {}))[identity.baseId] = [itemKey];
          const current = this._libraryInventory || inventory;
          current[identity.baseId] = {
            libraryKeys: [itemKey],
            managedKeys: [itemKey],
          };
        }
      }

      // Parent/attachment writes advance Zotero's library version. Invalidate
      // the snapshot before the child create so even a lost response cannot
      // leave a future mutation trusting the pre-write version.
      this._libraryInventoryVersion = null;
      const attachment = await this._ensureLinkedAttachment(itemKey, file);
      return {
        ok: true,
        status: repaired ? "repaired" : "complete",
        itemKey,
        managed: true,
        pdf: {
          ...file,
          storage: "linked-file",
          attachmentKey: attachment.key || (attachment.data && attachment.data.key),
        },
      };
    }

    add(paper) {
      let identity;
      try {
        identity = canonicalPaper(paper || {});
      } catch (error) {
        return Promise.reject(error);
      }
      const current = this._inFlight.get(identity.baseId);
      if (current) return current;
      const operation = this._add(paper || {}, identity).finally(() => {
        if (this._inFlight.get(identity.baseId) === operation) {
          this._inFlight.delete(identity.baseId);
        }
      });
      this._inFlight.set(identity.baseId, operation);
      return operation;
    }

    async remove(itemKey, expectedBaseId) {
      let duplicateKeys = [];
      let knownItem = false;
      let matchedBaseId = null;
      const inventory = await this._loadMutationInventory();
      const map = this._addedMap || {};
      for (const [baseId, keys] of Object.entries(map)) {
        const list = Array.isArray(keys) ? keys : [keys];
        if (list.includes(itemKey)) {
          knownItem = true;
          matchedBaseId = baseId;
          duplicateKeys = list.filter((key) => key !== itemKey);
          break;
        }
      }
      const normalizedExpectedBaseId = expectedBaseId
        ? String(expectedBaseId).toLowerCase()
        : null;
      if (
        normalizedExpectedBaseId &&
        matchedBaseId &&
        normalizedExpectedBaseId !== matchedBaseId
      ) {
        throw new Error("Zotero 条目的 arXiv 身份已变化，已拒绝删除");
      }
      if (itemKey && !knownItem) {
        throw new Error("拒绝删除不属于 Daily Paper 集合树的 Zotero 条目");
      }
      if (
        itemKey &&
        typeof this.client.isItemManagedInCollectionTree === "function" &&
        !(await this.client.isItemManagedInCollectionTree(
          itemKey,
          ROOT_COLLECTION_NAME,
          normalizedExpectedBaseId || matchedBaseId
        ))
      ) {
        throw new Error("Zotero 条目已移出集合树或身份已变化，已拒绝删除");
      }
      if (itemKey) await this.client.deleteItem(itemKey);
      this._libraryInventoryVersion = null;
      if (this._addedMap) {
        for (const [id, keys] of Object.entries(this._addedMap)) {
          const remaining = (Array.isArray(keys) ? keys : [keys]).filter(
            (key) => key !== itemKey
          );
          if (remaining.length) this._addedMap[id] = remaining;
          else delete this._addedMap[id];
        }
      }
      let libraryMatchRemaining = false;
      if (matchedBaseId && inventory[matchedBaseId]) {
        const descriptor = inventory[matchedBaseId];
        descriptor.managedKeys = descriptor.managedKeys.filter((key) => key !== itemKey);
        descriptor.libraryKeys = descriptor.libraryKeys.filter((key) => key !== itemKey);
        libraryMatchRemaining =
          descriptor.managedKeys.length === 0 && descriptor.libraryKeys.length > 0;
        if (!descriptor.libraryKeys.length) delete inventory[matchedBaseId];
      }
      // Zotero intentionally does not delete linked-file bytes.
      return {
        ok: true,
        linkedFilePreserved: true,
        remainingItemKey: duplicateKeys[0] || null,
        remainingDuplicates: duplicateKeys.length,
        libraryMatchRemaining,
      };
    }

    async listAddedMap(rootName) {
      const requestedRoot = rootName || ROOT_COLLECTION_NAME;
      if (requestedRoot !== ROOT_COLLECTION_NAME) {
        return this.client.listDailyPaperArxivMap(requestedRoot);
      }
      const inventory = await this._loadLibraryInventory();
      const flat = {};
      for (const [baseId, descriptor] of Object.entries(inventory || {})) {
        const managedKey = descriptor.managedKeys && descriptor.managedKeys[0];
        flat[baseId] = managedKey
          ? { state: "managed", itemKey: managedKey }
          : { state: "existing" };
      }
      return flat;
    }
  }

  // Build a Saver from the user's locally encrypted Zotero Web API session.
  // File bytes are handled separately by the App's linked-file flow.
  function fromSession(session, bridge) {
    if (
      !session ||
      !session.apiKey ||
      !session.userId ||
      typeof ZoteroClient === "undefined"
    ) {
      return null;
    }
    return new Saver(new ZoteroClient(session.apiKey, session.userId), bridge);
  }

  global.ZoteroSave = { fromSession, Saver, ROOT_COLLECTION_NAME };
})(window);
