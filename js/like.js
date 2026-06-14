// Wires up the "Add to Zotero" buttons in per-day report HTML pages.
//
// Activates only when sessionStorage has decrypted Zotero credentials, which
// the password gate (index.html) puts there before redirecting to personal.html.
// In guest mode the buttons stay hidden via CSS.
//
// PDF upload path (when WebDAV credentials are present in the bundle):
//   1. Fetch PDF bytes via Cloudflare Worker proxy (CORS workaround)
//   2. Compute MD5 of PDF
//   3. Create Zotero imported_url attachment with md5/mtime/filename set
//   4. PUT <key>.zip + <key>.prop to user's WebDAV via Worker proxy
//   5. Desktop Zotero picks up file on next sync
//
// LaTeX source upload (best effort, runs only after PDF upload succeeds):
//   Same four steps targeting https://arxiv.org/e-print/<id>. arXiv returns
//   gzipped tar for most papers; PDF-only papers are detected via %PDF magic
//   and skipped. Source failure does not roll back the PDF or parent item.
//
// Without WebDAV creds, falls back to a linked_url attachment so user at
// least has a clickable arXiv link from inside Zotero.
//
// Persists "saved" state in localStorage so the button keeps its "In Zotero"
// look across reloads without a Zotero round-trip.

(function () {
  const SESSION_SECRETS = "zotero_secrets";
  // sessionStorage key bumped to invalidate caches from earlier
  // "DailyPaper" naming.
  const SESSION_ROOT_COLLECTION = "zotero_daily_paper_root";
  const LOCAL_LIKED_MAP = "zotero_liked_map";
  const ROOT_COLLECTION_NAME = "Daily Paper";

  /**
   * Read credentials from sessionStorage. Tries the current document first,
   * then the parent frame as a defensive fallback in case some browser
   * configuration breaks same-origin iframe storage sharing.
   */
  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_SECRETS);
      if (raw) return JSON.parse(raw);
    } catch {}
    if (window.parent && window.parent !== window) {
      try {
        const raw = window.parent.sessionStorage.getItem(SESSION_SECRETS);
        if (raw) return JSON.parse(raw);
      } catch {}
    }
    return null;
  }

  function readLikedMap() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_LIKED_MAP) || "{}");
    } catch {
      return {};
    }
  }

  function writeLikedMap(map) {
    localStorage.setItem(LOCAL_LIKED_MAP, JSON.stringify(map));
  }

  function readPapersData() {
    const tag = document.getElementById("papers-data");
    if (!tag) return [];
    try {
      return JSON.parse(tag.textContent);
    } catch (e) {
      console.error("[zotero] failed to parse #papers-data:", e);
      return [];
    }
  }

  // Inline Zotero "Z" — Simple Icons (CC0). Sized via .zotero-icon (1em).
  const ZOTERO_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.231 2.462 7.18 20.923h14.564V24H2.256v-2.462L16.308 3.076H2.975V0h18.256v2.462z"/></svg>';
  const SPINNER_SVG = '<i class="fas fa-spinner fa-spin"></i>';

  function setBtnState(btn, state) {
    btn.dataset.state = state;
    btn.classList.toggle("saved", state === "saved");
    btn.disabled = state === "loading";
    const icon = btn.querySelector(".zotero-icon");
    const label = btn.querySelector(".zotero-label");
    if (state === "saved") {
      if (icon) icon.innerHTML = ZOTERO_SVG;
      if (label) label.textContent = "In Zotero";
    } else if (state === "loading") {
      if (icon) icon.innerHTML = SPINNER_SVG;
      if (label) label.textContent = "Adding...";
    } else {
      if (icon) icon.innerHTML = ZOTERO_SVG;
      if (label) label.textContent = "Add to Zotero";
    }
  }

  function showToast(msg, kind = "info") {
    let tray = document.getElementById("toast-tray");
    if (!tray) {
      tray = document.createElement("div");
      tray.id = "toast-tray";
      document.body.appendChild(tray);
    }
    const t = document.createElement("div");
    t.className = `toast toast-${kind}`;
    t.textContent = msg;
    tray.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, 4000);
  }

  async function getOrCreateTodayCollection(client) {
    let rootKey = sessionStorage.getItem(SESSION_ROOT_COLLECTION);
    if (!rootKey) {
      rootKey = await client.getOrCreateCollection(ROOT_COLLECTION_NAME);
      sessionStorage.setItem(SESSION_ROOT_COLLECTION, rootKey);
    }
    const today = new Date().toLocaleDateString("sv"); // YYYY-MM-DD
    return client.getOrCreateCollection(today, rootKey);
  }

  // Module-scoped — set in init() from the decrypted bundle.
  let proxyUrl = "";
  let webdavClient = null;

  // Cap on LaTeX source archive size. Cloudflare Workers have a request body
  // ceiling around 100 MB and a wall-clock CPU limit; 50 MB leaves headroom.
  const SOURCE_MAX_BYTES = 50 * 1024 * 1024;

  /**
   * Fetch arbitrary bytes through the Worker proxy. Throws on any failure
   * (network, non-2xx, suspiciously small payload). Returns Uint8Array.
   */
  async function fetchViaProxy(targetUrl) {
    const proxyFetchUrl = `${proxyUrl.replace(/\/$/, "")}/?url=${encodeURIComponent(targetUrl)}`;
    console.log("[zotero] proxy fetch:", proxyFetchUrl);
    let res;
    try {
      res = await fetch(proxyFetchUrl);
    } catch (e) {
      throw new Error(`代理 fetch 异常: ${e.message}`);
    }
    if (!res.ok) {
      throw new Error(`代理返回 HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    console.log("[zotero] proxy returned", buf.byteLength, "bytes");
    if (buf.byteLength < 1024) {
      throw new Error(`代理响应过小 (${buf.byteLength}B)`);
    }
    return new Uint8Array(buf);
  }

  /**
   * Common tail: compute MD5, register Zotero imported_url attachment with
   * WebDAV-bound metadata, PUT <key>.zip + <key>.prop to WebDAV. Throws on
   * any step's failure; returns the new attachment key on success.
   *
   * @param {{sourceUrl, filename, title, contentType}} opts
   */
  async function uploadFileToZoteroAndWebdav(client, parentKey, bytes, opts) {
    const md5 = computeMd5(bytes);
    const mtime = Date.now();
    console.log("[zotero] md5:", md5, "mtime:", mtime, "name:", opts.filename);

    const attachmentKey = await client.createImportedAttachment(parentKey, {
      title: opts.title,
      url: opts.sourceUrl,
      filename: opts.filename,
      contentType: opts.contentType,
      md5,
      mtime,
    });
    console.log("[zotero] attachment key:", attachmentKey);

    await webdavClient.upload(attachmentKey, bytes, opts.filename, mtime);
    return attachmentKey;
  }

  /**
   * PDF upload flow. Returns {ok: true} on success, {ok: false, reason} on
   * any step failure. Caller falls back to linked_url attachment on failure.
   */
  async function tryUploadPdf(client, parentKey, pdfUrl, arxivId) {
    if (!proxyUrl) return { ok: false, reason: "未配置 Worker 代理" };
    if (!webdavClient || !webdavClient.isConfigured()) {
      return { ok: false, reason: "未配置 WebDAV 凭据" };
    }
    let bytes;
    try {
      bytes = await fetchViaProxy(pdfUrl);
    } catch (e) {
      return { ok: false, reason: e.message };
    }
    try {
      await uploadFileToZoteroAndWebdav(client, parentKey, bytes, {
        sourceUrl: pdfUrl,
        filename: `${arxivId || "paper"}.pdf`,
        title: "Full Text PDF",
        contentType: "application/pdf",
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  /**
   * LaTeX source upload flow. Best-effort — returns {ok: false, reason} on
   * any failure (no LaTeX submission, oversized, network error, etc.). The
   * caller treats failure as non-fatal and surfaces the reason in toast.
   */
  async function tryUploadSource(client, parentKey, arxivId) {
    if (!arxivId) return { ok: false, reason: "无 arxiv_id" };
    if (!proxyUrl) return { ok: false, reason: "未配置 Worker 代理" };
    if (!webdavClient || !webdavClient.isConfigured()) {
      return { ok: false, reason: "未配置 WebDAV 凭据" };
    }

    const eprintUrl = `https://arxiv.org/e-print/${arxivId}`;
    let bytes;
    try {
      bytes = await fetchViaProxy(eprintUrl);
    } catch (e) {
      return { ok: false, reason: `源码拉取失败: ${e.message}` };
    }

    // arXiv returns the original PDF for PDF-only submissions (~5% of papers).
    // Detect by %PDF magic and skip — there's no LaTeX to translate.
    if (
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    ) {
      return { ok: false, reason: "无 LaTeX 源码（仅 PDF 提交）" };
    }
    // Expected: gzip magic 1f 8b. Anything else is likely an error page.
    if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) {
      return {
        ok: false,
        reason: `源码格式未知 (magic ${bytes[0].toString(16)} ${bytes[1].toString(16)})`,
      };
    }
    if (bytes.byteLength > SOURCE_MAX_BYTES) {
      return {
        ok: false,
        reason: `源码过大 (${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB > ${SOURCE_MAX_BYTES / 1024 / 1024}MB)`,
      };
    }

    try {
      await uploadFileToZoteroAndWebdav(client, parentKey, bytes, {
        sourceUrl: eprintUrl,
        filename: `${arxivId}-source.tar.gz`,
        title: "LaTeX Source",
        contentType: "application/gzip",
      });
      return { ok: true, sizeMb: (bytes.byteLength / 1024 / 1024).toFixed(1) };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  async function addPaper(btn, paper, client) {
    setBtnState(btn, "loading");
    try {
      const collKey = await getOrCreateTodayCollection(client);
      const itemKey = await client.createPreprintItem(paper, collKey);

      // Force https: arXiv's feed returns http:// URLs but the Worker
      // allowlist usually checks for https://arxiv.org/, so http variants
      // would get rejected with a 403 even though the redirect works.
      const pdfUrl = (paper.url || "")
        .replace(/^http:\/\//i, "https://")
        .replace("/abs/", "/pdf/");
      const arxivIdMatch = pdfUrl.match(/arxiv\.org\/pdf\/([^?#\s]+?)(?:\.pdf)?$/i);
      const arxivId = arxivIdMatch ? arxivIdMatch[1] : null;

      let pdfResult = { ok: false, reason: "无 PDF URL" };
      let sourceResult = null;

      if (pdfUrl && pdfUrl !== paper.url) {
        if (webdavClient && webdavClient.isConfigured()) {
          pdfResult = await tryUploadPdf(client, itemKey, pdfUrl, arxivId);
          // Only chase the source archive if PDF made it through. Source
          // failure is non-fatal; we log the reason for the toast.
          if (pdfResult.ok && arxivId) {
            sourceResult = await tryUploadSource(client, itemKey, arxivId);
          }
        } else {
          pdfResult = { ok: false, reason: "WebDAV 未配置" };
        }
        if (!pdfResult.ok) {
          try {
            await client.addLinkedAttachment(itemKey, pdfUrl, "View arXiv PDF");
          } catch (e) {
            console.warn("[zotero] linked attachment also failed:", e);
          }
        }
      }

      const map = readLikedMap();
      map[paper.url] = itemKey;
      writeLikedMap(map);

      btn.dataset.itemKey = itemKey;
      setBtnState(btn, "saved");

      let toastMsg, toastKind;
      if (pdfResult.ok && sourceResult && sourceResult.ok) {
        toastMsg = `已保存到 Zotero（PDF + 源码 ${sourceResult.sizeMb}MB 已上传 WebDAV）`;
        toastKind = "success";
      } else if (pdfResult.ok) {
        toastMsg = sourceResult
          ? `已保存到 Zotero（PDF 已上传，源码：${sourceResult.reason}）`
          : "已保存到 Zotero（PDF 已上传 WebDAV，Sync 后桌面可见）";
        toastKind = "success";
      } else {
        toastMsg = `已保存到 Zotero（仅链接，原因：${pdfResult.reason}）`;
        toastKind = "info";
      }
      showToast(toastMsg, toastKind);
    } catch (e) {
      console.error("[zotero] add failed:", e);
      setBtnState(btn, "idle");
      showToast(`保存失败：${e.message}`, "error");
    }
  }

  async function removePaper(btn, paper, client) {
    setBtnState(btn, "loading");
    try {
      const itemKey = btn.dataset.itemKey;
      if (itemKey) {
        await client.deleteItem(itemKey);
      }
      const map = readLikedMap();
      delete map[paper.url];
      writeLikedMap(map);

      delete btn.dataset.itemKey;
      setBtnState(btn, "idle");
      showToast("已从 Zotero 删除", "success");
    } catch (e) {
      console.error("[zotero] remove failed:", e);
      setBtnState(btn, "saved");
      showToast(`删除失败：${e.message}`, "error");
    }
  }

  function init() {
    const session = readSession();
    if (!session) {
      // Guest mode: leave body without `.zotero-mode`, buttons stay hidden via CSS.
      return;
    }

    if (typeof ZoteroClient === "undefined") {
      console.error("[zotero] ZoteroClient not loaded — js/zotero.js missing?");
      return;
    }

    document.body.classList.add("zotero-mode");

    proxyUrl = session.pdfProxyUrl || "";
    console.log("[zotero] init: proxy =", proxyUrl || "(none)");

    // WebDAV client: only construct if all three creds are present.
    if (
      session.webdavUrl &&
      session.webdavUser &&
      session.webdavPass &&
      typeof WebdavSync !== "undefined"
    ) {
      webdavClient = new WebdavSync({
        baseUrl: session.webdavUrl,
        user: session.webdavUser,
        pass: session.webdavPass,
        proxyUrl,
      });
      console.log("[zotero] init: webdav =", session.webdavUrl);
    } else {
      const reasons = [];
      if (!session.webdavUrl) reasons.push("webdavUrl");
      if (!session.webdavUser) reasons.push("webdavUser");
      if (!session.webdavPass) reasons.push("webdavPass");
      if (typeof WebdavSync === "undefined") reasons.push("WebdavSync class");
      console.log(
        "[zotero] init: webdav DISABLED — missing:",
        reasons.join(", ") || "(unknown)"
      );
    }

    const client = new ZoteroClient(session.apiKey, session.userId);
    const papers = readPapersData();
    const likedMap = readLikedMap();
    const buttons = document.querySelectorAll(".zotero-btn");

    buttons.forEach((btn) => {
      const idx = parseInt(btn.dataset.paperIndex, 10);
      const paper = papers[idx];
      if (!paper) {
        btn.style.display = "none";
        return;
      }

      // Belt + suspenders alongside body.zotero-mode CSS rule.
      btn.style.display = "inline-flex";

      const cachedItemKey = likedMap[paper.url];
      if (cachedItemKey) {
        btn.dataset.itemKey = cachedItemKey;
        setBtnState(btn, "saved");
      } else {
        setBtnState(btn, "idle");
      }

      btn.addEventListener("click", () => {
        if (btn.dataset.state === "loading") return;
        if (btn.dataset.state === "saved") {
          removePaper(btn, paper, client);
        } else {
          addPaper(btn, paper, client);
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
