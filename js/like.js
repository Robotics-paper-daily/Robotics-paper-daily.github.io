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

  /**
   * Run the full PDF → WebDAV upload flow for one paper.
   * Returns:
   *   {ok: true}                         success — desktop Zotero will see
   *                                       the file on next sync
   *   {ok: false, reason: "..."}         which step died (surfaced in toast
   *                                       so the user doesn't need DevTools)
   *
   * The caller is expected to fall back to a linked-URL attachment when this
   * returns ok:false.
   */
  async function tryUploadToWebdav(client, parentKey, pdfUrl, arxivId) {
    if (!proxyUrl) {
      return { ok: false, reason: "未配置 Worker 代理" };
    }
    if (!webdavClient || !webdavClient.isConfigured()) {
      return { ok: false, reason: "未配置 WebDAV 凭据" };
    }

    // Step 1: fetch PDF bytes via Worker proxy
    const proxyFetchUrl = `${proxyUrl.replace(/\/$/, "")}/?url=${encodeURIComponent(pdfUrl)}`;
    console.log("[zotero] proxy fetch:", proxyFetchUrl);
    let res;
    try {
      res = await fetch(proxyFetchUrl);
    } catch (e) {
      return { ok: false, reason: `代理 fetch 异常: ${e.message}` };
    }
    if (!res.ok) {
      return { ok: false, reason: `代理返回 HTTP ${res.status}` };
    }
    const pdfBytes = await res.arrayBuffer();
    console.log("[zotero] proxy returned", pdfBytes.byteLength, "bytes");
    if (pdfBytes.byteLength < 1024) {
      return {
        ok: false,
        reason: `代理响应过小 (${pdfBytes.byteLength}B)`,
      };
    }

    // Step 2: compute MD5 of the original PDF (becomes attachment.md5)
    const pdfMd5 = computeMd5(pdfBytes);
    const mtime = Date.now();
    const filename = `${arxivId || "paper"}.pdf`;
    console.log("[zotero] PDF md5:", pdfMd5, "mtime:", mtime, "name:", filename);

    // Step 3: register the attachment in Zotero with WebDAV-bound metadata
    let attachmentKey;
    try {
      attachmentKey = await client.createImportedAttachment(parentKey, {
        title: "Full Text PDF",
        url: pdfUrl,
        filename,
        contentType: "application/pdf",
        md5: pdfMd5,
        mtime,
      });
    } catch (e) {
      return { ok: false, reason: `Zotero 创建附件失败: ${e.message}` };
    }
    console.log("[zotero] attachment key:", attachmentKey);

    // Step 4: PUT zip + prop to WebDAV
    try {
      await webdavClient.upload(attachmentKey, pdfBytes, filename, mtime);
    } catch (e) {
      return { ok: false, reason: `WebDAV 上传: ${e.message}` };
    }

    return { ok: true };
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
      if (pdfUrl && pdfUrl !== paper.url) {
        if (webdavClient && webdavClient.isConfigured()) {
          pdfResult = await tryUploadToWebdav(client, itemKey, pdfUrl, arxivId);
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
      showToast(
        pdfResult.ok
          ? "已保存到 Zotero（PDF 已上传 WebDAV，Sync 后桌面可见）"
          : `已保存到 Zotero（仅链接，原因：${pdfResult.reason}）`,
        pdfResult.ok ? "success" : "info"
      );
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
