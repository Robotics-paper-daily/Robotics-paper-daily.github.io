// Wires up "Add to Zotero" inside PaperReader's sandboxed report frame.
//
// v0.3.0 intentionally supports writes only through the desktop App. A static
// website cannot atomically write Zotero linked files into the user's local
// OneDrive folder or confirm that macOS File Provider uploaded them. Keeping a
// second WebDAV/imported-file path would create two incompatible attachment
// models, so public report pages stay read-only and show an App-only notice.

(function () {
  const LOCAL_LIKED_MAP = "zotero_liked_map";
  const ROOT_COLLECTION_NAME = "Daily Paper";
  // Background reconcile against the real Zotero library (source of truth).
  // Cached per session so day-switches (iframe reloads) don't re-hit the API.
  const SESSION_ADDED_CACHE = "zotero_added_cache"; // { ts, map: {baseId: {state,itemKey?}} }
  const ADDED_CACHE_TTL_MS = 5 * 60 * 1000;

  function readLikedMap() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_LIKED_MAP) || "{}");
    } catch {
      return {};
    }
  }

  function writeLikedMap(map) {
    // Unique-origin sandboxed reports have no usable localStorage. This map is
    // only a UI cache; the Zotero RPC reconcile remains the source of truth, so
    // storage denial must never turn a committed add/remove into a false error.
    try {
      localStorage.setItem(LOCAL_LIKED_MAP, JSON.stringify(map));
    } catch {}
  }

  function appZoteroApi() {
    const rpc = window.PaperReaderReportBridge;
    if (rpc && rpc.zoteroEnabled) {
      return {
        isUnlocked: () => true,
        add: (paper) => rpc.zoteroAdd(paper),
        remove: (itemRef) => rpc.zoteroRemove(itemRef),
        listDailyPaperArxivMap: (_rootName, baseIds) => rpc.zoteroList(baseIds),
      };
    }
    return null;
  }

  function isAppReport() {
    try {
      return new URLSearchParams(window.location.search || "").get("app") === "1";
    } catch {
      return false;
    }
  }

  function showAppOnlyNotice() {
    if (isAppReport() || document.getElementById("zotero-app-only-notice")) return;
    const notice = document.createElement("aside");
    notice.id = "zotero-app-only-notice";
    notice.setAttribute("role", "note");
    notice.innerHTML =
      '<strong>Add to Zotero 已迁移至 PaperReader Mac App。</strong>' +
      '<span> 网页版现为只读浏览，不再写入 Zotero/WebDAV，以免产生失效附件。</span>' +
      '<a href="https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io#v030-paperreader-for-macos" target="_blank" rel="noopener noreferrer">查看 v0.3.0 发布状态</a>';
    const style = document.createElement("style");
    style.textContent =
      "#zotero-app-only-notice{max-width:1180px;margin:1rem auto;padding:.75rem 1rem;" +
      "border:1px solid #d8b4fe;border-radius:.75rem;background:#faf5ff;color:#581c87;" +
      "font:500 .86rem/1.55 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
      "#zotero-app-only-notice a{margin-left:.65rem;color:#6b21a8;font-weight:700;text-decoration:underline}";
    (document.head || document.documentElement).appendChild(style);
    document.body.insertBefore(notice, document.body.firstChild);
  }

  function reportDate() {
    try {
      const match = String(window.location && window.location.pathname).match(
        /(\d{4})[-_](\d{2})[-_](\d{2})/
      );
      return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
    } catch {
      return "";
    }
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

  function zoteroSvg(name, body, spinning = false) {
    return (
      `<svg class="zotero-svg-icon${spinning ? " zotero-svg-icon-spin" : ""}" ` +
      `data-zotero-icon="${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
      `${body}</svg>`
    );
  }

  // Inline Zotero "Z" — Simple Icons (CC0). All transient state icons are
  // inline too, because App reports intentionally cannot load icon webfonts.
  const ZOTERO_SVG = zoteroSvg(
    "zotero",
    '<path d="M21.231 2.462 7.18 20.923h14.564V24H2.256v-2.462L16.308 3.076H2.975V0h18.256v2.462z"/>'
  );
  const SPINNER_SVG = zoteroSvg(
    "loading",
    '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="40 14"/>',
    true
  );
  const SYNC_DONE_SVG = zoteroSvg(
    "done",
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8 12 2.6 2.6L16.5 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
  );
  const SYNC_ERROR_SVG = zoteroSvg(
    "error",
    '<path d="M12 3 2.8 20h18.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8v5m0 3.2v.1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
  );

  function injectZoteroIconStyles() {
    if (document.getElementById("zotero-inline-icon-styles")) return;
    const style = document.createElement("style");
    style.id = "zotero-inline-icon-styles";
    style.textContent =
      ".zotero-svg-icon{display:block;width:1em;height:1em;overflow:visible;fill:currentColor;flex:0 0 auto}" +
      ".zotero-icon .zotero-svg-icon{width:100%;height:100%}" +
      ".zotero-svg-icon-spin{animation:zotero-icon-spin .8s linear infinite}" +
      "#zotero-sync-status .zotero-svg-icon{width:16px;height:16px}" +
      "@keyframes zotero-icon-spin{to{transform:rotate(360deg)}}";
    (document.head || document.documentElement).appendChild(style);
  }

  function setBtnState(btn, state) {
    injectZoteroIconStyles();
    btn.dataset.state = state;
    btn.classList.toggle("saved", state === "saved" || state === "existing");
    btn.disabled = state === "loading";
    const icon = btn.querySelector(".zotero-icon");
    const label = btn.querySelector(".zotero-label");
    if (state === "saved") {
      if (icon) icon.innerHTML = ZOTERO_SVG;
      if (label) label.textContent = "In Zotero · Remove";
      btn.title = "从 Zotero 删除条目（OneDrive 中的链接 PDF 会保留）";
    } else if (state === "existing") {
      if (icon) icon.innerHTML = ZOTERO_SVG;
      if (label) label.textContent = "In Zotero";
      btn.title = "你的 Zotero 库中已有此论文；PaperReader 不会重复创建或删除原条目";
    } else if (state === "loading") {
      if (icon) icon.innerHTML = SPINNER_SVG;
      if (label) label.textContent = "Adding...";
      btn.title = "";
    } else {
      if (icon) icon.innerHTML = ZOTERO_SVG;
      if (label) label.textContent = "Add to Zotero";
      btn.title = "将论文与 OneDrive 链接 PDF 加入 Zotero";
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

  async function addPaper(btn, paper, client) {
    setBtnState(btn, "loading");
    try {
      if (!client) throw new Error("Add to Zotero 仅在 PaperReader App 中可用");
      const result = await client.add({ ...paper, date: reportDate() });
      const itemKey = result && result.itemKey;
      const libraryOnly = !!(
        result &&
        (result.state === "existing" || result.status === "already-in-library")
      );
      if (!libraryOnly && !itemKey) throw new Error("App 未返回 Zotero 条目 key");

      const map = readLikedMap();
      if (libraryOnly) delete map[paper.url];
      else map[paper.url] = itemKey;
      writeLikedMap(map);
      patchAddedCache(
        paperBaseId(paper),
        libraryOnly
          ? { state: "existing" }
          : { state: "managed", itemKey }
      );

      if (libraryOnly) {
        delete btn.dataset.itemKey;
        setBtnState(btn, "existing");
      } else {
        btn.dataset.itemKey = itemKey;
        setBtnState(btn, "saved");
      }

      showToast(
        libraryOnly
          ? "已在你的 Zotero 库中（不会重复创建或改动原条目）"
          : result.status === "already-added"
            ? "已在 Zotero 中（未重复创建）"
            : "已保存到 Zotero（OneDrive 云端已确认）",
        "success"
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
      const localApp = client || appZoteroApi();
      if (!localApp) throw new Error("Zotero 删除仅在 PaperReader App 中可用");
      let removal = null;
      if (itemKey) {
        removal = await localApp.remove(itemKey);
      }
      const map = readLikedMap();

      // Historical versions of the wheel created duplicate parents for some
      // base arXiv IDs. Delete only the explicit item (never bulk-delete), and
      // keep the button honest when another duplicate remains.
      if (removal && removal.remainingItemKey) {
        map[paper.url] = removal.remainingItemKey;
        writeLikedMap(map);
        patchAddedCache(paperBaseId(paper), {
          state: "managed",
          itemKey: removal.remainingItemKey,
        });
        btn.dataset.itemKey = removal.remainingItemKey;
        setBtnState(btn, "saved");
        showToast(
          `已删除一个重复 Zotero 条目；仍有 ${removal.remainingDuplicates} 个同 ID 条目`,
          "info"
        );
        return;
      }

      if (removal && removal.libraryMatchRemaining) {
        delete map[paper.url];
        writeLikedMap(map);
        patchAddedCache(paperBaseId(paper), { state: "existing" });
        delete btn.dataset.itemKey;
        setBtnState(btn, "existing");
        showToast("已删除 PaperReader 条目；你的 Zotero 库中仍有同一论文", "info");
        return;
      }

      delete map[paper.url];
      writeLikedMap(map);
      patchAddedCache(paperBaseId(paper), null);

      delete btn.dataset.itemKey;
      setBtnState(btn, "idle");
      showToast("已从 Zotero 删除（OneDrive 中的链接文件会保留）", "success");
    } catch (e) {
      console.error("[zotero] remove failed:", e);
      setBtnState(btn, "saved");
      showToast(`删除失败：${e.message}`, "error");
    }
  }

  // ---- Zotero reconcile: keep "In Zotero" honest against the real library ----

  function paperBaseId(paper) {
    if (!paper) return null;
    const match = String(paper.url || "").match(
      /arxiv\.org\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7}))(?:v\d+)?/i
    );
    return match ? match[1].toLowerCase() : null;
  }

  // Session cache of the added-map so switching days doesn't re-query Zotero.
  function readAddedCache() {
    try {
      const c = JSON.parse(sessionStorage.getItem(SESSION_ADDED_CACHE) || "null");
      if (c && c.map && c.ts && Date.now() - c.ts < ADDED_CACHE_TTL_MS) return c.map;
    } catch {}
    return null;
  }
  function writeAddedCache(map) {
    try {
      sessionStorage.setItem(SESSION_ADDED_CACHE, JSON.stringify({ ts: Date.now(), map }));
    } catch {}
  }
  // Keep the cache coherent after a manual add/remove (don't refresh the TTL).
  function patchAddedCache(baseId, match) {
    if (!baseId) return;
    try {
      const c = JSON.parse(sessionStorage.getItem(SESSION_ADDED_CACHE) || "null");
      const map = (c && c.map) || {};
      if (match) map[baseId] = match;
      else delete map[baseId];
      sessionStorage.setItem(
        SESSION_ADDED_CACHE,
        JSON.stringify({ ts: (c && c.ts) || Date.now(), map })
      );
    } catch {}
  }

  // Small, unobtrusive sync indicator — JS-injected so it needs no template change.
  function injectSyncStyles() {
    if (document.getElementById("zotero-sync-styles")) return;
    const css =
      "#zotero-sync-status{position:fixed;left:1rem;bottom:1rem;z-index:9998;display:none;" +
      "align-items:center;gap:.45rem;padding:.4rem .85rem;border-radius:999px;font-size:.78rem;" +
      "font-weight:600;font-family:inherit;background:#fff;border:1px solid rgba(226,232,240,.95);" +
      "box-shadow:0 4px 14px rgba(15,23,42,.12);color:#475569;transition:opacity .3s ease}" +
      "#zotero-sync-status.show{display:inline-flex}" +
      "#zotero-sync-status.error{color:#b91c1c;border-color:rgba(185,28,28,.3)}" +
      "#zotero-sync-status.done{color:#047857;border-color:rgba(16,185,129,.3)}";
    const s = document.createElement("style");
    s.id = "zotero-sync-styles";
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  let syncHideTimer = null;
  function setSyncStatus(state, text) {
    injectSyncStyles();
    injectZoteroIconStyles();
    let el = document.getElementById("zotero-sync-status");
    if (!el) {
      el = document.createElement("div");
      el.id = "zotero-sync-status";
      document.body.appendChild(el);
    }
    if (syncHideTimer) {
      clearTimeout(syncHideTimer);
      syncHideTimer = null;
    }
    if (state === "hidden") {
      el.classList.remove("show");
      return;
    }
    el.className = "show" + (state === "error" ? " error" : state === "done" ? " done" : "");
    const icon =
      state === "syncing"
        ? SPINNER_SVG
        : state === "done"
          ? SYNC_DONE_SVG
          : SYNC_ERROR_SVG;
    el.innerHTML = icon + '<span class="zss-text"></span>';
    el.querySelector(".zss-text").textContent = text;
    if (state === "done" || state === "error") {
      syncHideTimer = setTimeout(() => el.classList.remove("show"), 3000);
    }
  }

  /**
   * Reconcile every button on the page against the real Zotero library: mark
   * every paper found anywhere in the connected personal library. App-managed
   * Daily Paper items remain removable; all other matches are presence-only.
   * Uses the session cache when fresh (silent); otherwise queries Zotero with a
   * visible indicator. Network failure keeps local state untouched.
   */
  async function reconcileWithZotero(client, buttons, papers) {
    if (!buttons.length) return;
    let map = readAddedCache();
    const fromCache = !!map;
    if (!map) {
      setSyncStatus("syncing", "Zotero 同步中…");
      try {
        map = await client.listDailyPaperArxivMap(
          ROOT_COLLECTION_NAME,
          papers.map((paper) => paperBaseId(paper)).filter(Boolean)
        );
        writeAddedCache(map);
      } catch (e) {
        console.warn("[zotero] reconcile failed:", e);
        setSyncStatus("error", "Zotero 同步失败（保留本地状态）");
        return; // keep whatever localStorage gave us
      }
    }
    const liked = readLikedMap();
    buttons.forEach((btn) => {
      if (btn.dataset.state === "loading") return;
      const idx = parseInt(btn.dataset.paperIndex, 10);
      const paper = papers[idx];
      if (!paper) return;
      const baseId = paperBaseId(paper);
      const match = baseId ? map[baseId] : null;
      const legacyItemKey = typeof match === "string" ? match : null;
      const state = legacyItemKey ? "managed" : match && match.state;
      const itemKey = legacyItemKey || (match && match.itemKey);
      if (state === "managed" && itemKey) {
        btn.dataset.itemKey = itemKey;
        setBtnState(btn, "saved");
        liked[paper.url] = itemKey;
      } else if (state === "existing") {
        delete liked[paper.url];
        delete btn.dataset.itemKey;
        setBtnState(btn, "existing");
      } else {
        // not in Zotero (anymore) → drop stale saved state
        delete liked[paper.url];
        delete btn.dataset.itemKey;
        if (btn.dataset.state === "saved" || btn.dataset.state === "existing") {
          setBtnState(btn, "idle");
        }
      }
    });
    writeLikedMap(liked);
    if (!fromCache) {
      // The shell deliberately returns only matches for this report, not a
      // count/enumeration of the user's whole library. Label the number
      // honestly so a successful full-library bind is not mistaken for an
      // inventory containing only the papers visible today.
      setSyncStatus("done", `Zotero 已同步（本页匹配 ${Object.keys(map).length} 篇）`);
    }
  }

  function init() {
    const localApp = appZoteroApi();
    const appUnlocked = !!(
      localApp &&
      (typeof localApp.isUnlocked !== "function" || localApp.isUnlocked())
    );
    if (!appUnlocked) {
      // Public reports are intentionally read-only. In an App guest session,
      // the shell owns the setup affordance and no website notice is needed.
      showAppOnlyNotice();
      return;
    }

    document.body.classList.add("zotero-mode");

    const client = localApp;
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
        if (btn.dataset.state === "existing") {
          showToast("这篇论文已在你的 Zotero 库中，PaperReader 不会重复创建", "info");
          return;
        }
        if (btn.dataset.state === "saved") {
          removePaper(btn, paper, client);
        } else {
          addPaper(btn, paper, client);
        }
      });
    });

    // Background: reconcile the buttons against the real Zotero library so the
    // "In Zotero" state is accurate across devices/sessions, not just localStorage.
    reconcileWithZotero(client, buttons, papers);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
