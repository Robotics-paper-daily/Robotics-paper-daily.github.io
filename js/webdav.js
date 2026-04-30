// WebDAV uploader for Zotero file storage (linked-storage / WebDAV mode).
//
// Builds the Zotero-format <key>.zip + <key>.prop pair and PUTs them to the
// user's WebDAV server through the Cloudflare Worker proxy. The proxy is
// required because most WebDAV servers don't return CORS headers for
// browser-issued PUT requests.
//
// Zotero's WebDAV layout (per upstream):
//   <base>/<key>.zip   — ZIP archive containing the original file (no
//                        compression matters; Zotero just looks at the
//                        entry name inside)
//   <base>/<key>.prop  — XML file with mtime + MD5 of the .zip (NOT the PDF)
//
// On next sync, desktop Zotero scans WebDAV, downloads .zip + .prop, verifies
// .zip's MD5 against .prop, extracts the entry whose name matches the
// attachment's `filename` field, then verifies that entry's MD5 against the
// attachment's `md5` field (set via the Web API at attachment creation).

(function (global) {
  class WebdavSync {
    /**
     * @param {{baseUrl, user, pass, proxyUrl}} cfg
     *   baseUrl   — e.g. "https://mori.teracloud.jp/dav/zotero" (no trailing /)
     *   user/pass — Basic auth credentials
     *   proxyUrl  — Cloudflare Worker URL (same one used for arXiv fetch)
     */
    constructor(cfg) {
      this.baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
      this.user = cfg.user || "";
      this.pass = cfg.pass || "";
      this.proxyUrl = (cfg.proxyUrl || "").replace(/\/+$/, "");
    }

    isConfigured() {
      return !!(this.baseUrl && this.user && this.pass && this.proxyUrl);
    }

    /**
     * Upload one Zotero attachment's file payload to WebDAV.
     *
     * @param {string} itemKey       Zotero attachment item key
     * @param {ArrayBuffer|Uint8Array} pdfBytes   raw PDF
     * @param {string} filename      goes inside the ZIP as the entry name;
     *                                 must match what was set on the
     *                                 attachment record via Web API
     * @param {number} mtime         ms-since-epoch; must match what was set
     *                                 on the attachment record (so desktop
     *                                 sync doesn't see them as out of sync)
     */
    async upload(itemKey, pdfBytes, filename, mtime) {
      if (!this.isConfigured()) {
        throw new Error("WebDAV 未配置完整");
      }
      if (typeof JSZip === "undefined") {
        throw new Error("JSZip 未加载（检查 paper_template.html 的 CDN）");
      }

      // Build the .zip. JSZip defaults are fine — Zotero doesn't care about
      // compression level, just that the entry name matches `filename`.
      const zip = new JSZip();
      zip.file(filename, pdfBytes);
      const zipBytes = await zip.generateAsync({ type: "uint8array" });
      const zipMd5 = computeMd5(zipBytes);

      // .prop XML. mtime and hash refer to the .zip file, not the PDF.
      // Trailing newline is harmless and matches what Zotero desktop writes.
      const propXml =
        '<properties version="1">\n' +
        `<mtime>${mtime}</mtime>\n` +
        `<hash>${zipMd5}</hash>\n` +
        "</properties>\n";

      const zipUrl = `${this.baseUrl}/${itemKey}.zip`;
      const propUrl = `${this.baseUrl}/${itemKey}.prop`;

      // Order matters: write .zip first, then .prop. Desktop sync uses the
      // presence of .prop (with matching hash) as the "ready" signal; if we
      // wrote .prop before the .zip was fully there, sync could try to
      // extract a partial archive.
      console.log("[webdav] PUT", zipUrl, `(${zipBytes.byteLength}B)`);
      await this._put(zipUrl, zipBytes, "application/zip");
      console.log("[webdav] PUT", propUrl);
      await this._put(propUrl, propXml, "application/xml; charset=utf-8");
    }

    async _put(targetUrl, body, contentType) {
      const auth = "Basic " + btoa(`${this.user}:${this.pass}`);
      const url = `${this.proxyUrl}/?webdav-put=${encodeURIComponent(targetUrl)}`;
      let res;
      try {
        res = await fetch(url, {
          method: "PUT",
          headers: {
            "X-WebDAV-Auth": auth,
            "Content-Type": contentType,
          },
          body,
        });
      } catch (e) {
        throw new Error(`PUT 网络异常: ${e.message}`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`PUT ${targetUrl} → ${res.status}: ${text.slice(0, 200)}`);
      }
    }
  }

  global.WebdavSync = WebdavSync;
})(window);
