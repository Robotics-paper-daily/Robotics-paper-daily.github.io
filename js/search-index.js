(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SearchIndexLoader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const SHARD_NAME_RE = /^\d{4}-\d{2}(?:-\d{3})?\.json$/;

  async function fetchJson(fetchImpl, url) {
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response || !response.ok) {
      const status = response ? `HTTP ${response.status}` : "no response";
      throw new Error(`${status} while loading ${url}`);
    }
    return response.json();
  }

  async function loadSearchIndex(options) {
    const opts = options || {};
    const baseUrl = String(opts.baseUrl || "search_index").replace(/\/+$/, "");
    const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch.bind(root) : null);
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    if (!fetchImpl) throw new Error("fetch is unavailable");

    const cacheBust = opts.cacheBust === false ? "" : String(opts.cacheBust || Date.now());
    const suffix = cacheBust ? `?v=${encodeURIComponent(cacheBust)}` : "";
    try {
      const manifest = await fetchJson(fetchImpl, `${baseUrl}/manifest.json${suffix}`);
      if (
        !manifest ||
        manifest.version !== 1 ||
        !Number.isInteger(manifest.total) ||
        manifest.total < 0 ||
        !Array.isArray(manifest.shards)
      ) {
        throw new Error("invalid search-index manifest");
      }

      const seen = new Set();
      const papers = [];
      const totalShards = manifest.shards.length;
      if (onProgress) {
        onProgress({ loadedShards: 0, totalShards, loadedPapers: 0, totalPapers: manifest.total });
      }

      for (let index = 0; index < totalShards; index += 1) {
        const shard = manifest.shards[index];
        if (
          !shard ||
          typeof shard.file !== "string" ||
          !SHARD_NAME_RE.test(shard.file) ||
          seen.has(shard.file) ||
          !Number.isInteger(shard.count) ||
          shard.count < 0
        ) {
          throw new Error("invalid search-index shard entry");
        }
        seen.add(shard.file);
        const items = await fetchJson(fetchImpl, `${baseUrl}/${shard.file}${suffix}`);
        if (!Array.isArray(items) || items.length !== shard.count) {
          throw new Error(`search-index shard count mismatch: ${shard.file}`);
        }
        for (const item of items) papers.push(item);
        if (onProgress) {
          onProgress({
            loadedShards: index + 1,
            totalShards,
            loadedPapers: papers.length,
            totalPapers: manifest.total,
          });
        }
      }

      if (papers.length !== manifest.total) {
        throw new Error(
          `search-index total mismatch: expected ${manifest.total}, received ${papers.length}`
        );
      }
      return { papers, manifest, legacy: false };
    } catch (shardError) {
      if (!opts.legacyUrl) throw shardError;
      if (typeof opts.onFallback === "function") opts.onFallback(shardError);
      try {
        const legacyUrl = String(opts.legacyUrl);
        const papers = await fetchJson(fetchImpl, `${legacyUrl}${suffix}`);
        if (!Array.isArray(papers)) throw new Error("legacy search index is not an array");
        if (onProgress) {
          onProgress({
            loadedShards: 1,
            totalShards: 1,
            loadedPapers: papers.length,
            totalPapers: papers.length,
            legacy: true,
          });
        }
        return { papers, manifest: null, legacy: true };
      } catch (legacyError) {
        throw new Error(
          `${shardError.message}; legacy fallback failed: ${legacyError.message}`
        );
      }
    }
  }

  return { loadSearchIndex };
});
