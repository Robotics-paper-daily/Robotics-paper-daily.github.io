// App-side Zotero "save a paper" core, shared by the search panel and the
// read-modal "加入 Zotero". Mirrors js/like.js's add flow but without the
// report-card button/toast/localStorage coupling — callers own their own UI.
//
// Requires (loaded by shell.html before this): ZoteroClient + computeMd5 +
// extractArxivId (js/zotero.js), WebdavSync (js/webdav.js), SparkMD5 + JSZip
// (vendor). app://local can make the cross-origin Zotero / proxy / WebDAV calls,
// same as the report iframe's like.js.
(function (global) {
  const ROOT_COLLECTION_NAME = "Daily Paper";

  async function fetchViaProxy(proxyUrl, targetUrl) {
    const u = `${proxyUrl.replace(/\/$/, "")}/?url=${encodeURIComponent(targetUrl)}`;
    const res = await fetch(u);
    if (!res.ok) throw new Error(`代理返回 HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1024) throw new Error(`代理响应过小 (${buf.byteLength}B)`);
    return new Uint8Array(buf);
  }

  class Saver {
    constructor(client, proxyUrl, webdav) {
      this.client = client;
      this.proxyUrl = proxyUrl || "";
      this.webdav = webdav || null;
    }

    async _todayCollection() {
      const rootKey = await this.client.getOrCreateCollection(ROOT_COLLECTION_NAME);
      const today = new Date().toLocaleDateString("sv"); // YYYY-MM-DD
      return this.client.getOrCreateCollection(today, rootKey);
    }

    async _uploadPdf(parentKey, pdfUrl, arxivId) {
      if (!this.proxyUrl) return { ok: false, reason: "未配置 Worker 代理" };
      if (!this.webdav || !this.webdav.isConfigured()) return { ok: false, reason: "未配置 WebDAV" };
      let bytes;
      try {
        bytes = await fetchViaProxy(this.proxyUrl, pdfUrl);
      } catch (e) {
        return { ok: false, reason: e.message };
      }
      try {
        const md5 = computeMd5(bytes);
        const mtime = Date.now();
        const filename = `${arxivId || "paper"}.pdf`;
        const attachmentKey = await this.client.createImportedAttachment(parentKey, {
          title: "Full Text PDF",
          url: pdfUrl,
          filename,
          contentType: "application/pdf",
          md5,
          mtime,
        });
        await this.webdav.upload(attachmentKey, bytes, filename, mtime);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    }

    // Create the preprint item, then upload the PDF to WebDAV (or fall back to a
    // linked_url). Returns { ok, itemKey, pdf:{ok,reason} }. Throws if the item
    // itself can't be created.
    async add(paper) {
      const collKey = await this._todayCollection();
      const itemKey = await this.client.createPreprintItem(paper, collKey);
      const pdfUrl = (paper.url || "").replace(/^http:\/\//i, "https://").replace("/abs/", "/pdf/");
      const arxivId = extractArxivId(pdfUrl) || extractArxivId(paper.url) || "paper";
      let pdf = { ok: false, reason: "无 PDF URL" };
      if (pdfUrl && pdfUrl !== paper.url) {
        pdf = await this._uploadPdf(itemKey, pdfUrl, arxivId);
        if (!pdf.ok) {
          try {
            await this.client.addLinkedAttachment(itemKey, pdfUrl, "View arXiv PDF");
          } catch {}
        }
      }
      return { ok: true, itemKey, pdf };
    }

    async remove(itemKey) {
      if (itemKey) await this.client.deleteItem(itemKey);
      return { ok: true };
    }

    listAddedMap(rootName) {
      return this.client.listDailyPaperArxivMap(rootName || ROOT_COLLECTION_NAME);
    }
  }

  // Build a Saver from decrypted session creds, or null in guest mode / if the
  // Zotero client isn't loaded.
  function fromSession(session) {
    if (!session || typeof ZoteroClient === "undefined") return null;
    const client = new ZoteroClient(session.apiKey, session.userId);
    const proxyUrl = session.pdfProxyUrl || "";
    let webdav = null;
    if (
      session.webdavUrl &&
      session.webdavUser &&
      session.webdavPass &&
      typeof WebdavSync !== "undefined"
    ) {
      webdav = new WebdavSync({
        baseUrl: session.webdavUrl,
        user: session.webdavUser,
        pass: session.webdavPass,
        proxyUrl,
      });
    }
    return new Saver(client, proxyUrl, webdav);
  }

  global.ZoteroSave = { fromSession, ROOT_COLLECTION_NAME };
})(window);
