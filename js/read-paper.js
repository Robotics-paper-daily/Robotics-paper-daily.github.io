// Wires up the "帮我读" buttons that hand a paper off to the local Claude Code
// CLI to deep-read it with the paper-reading skill (in the Obsidian vault) and
// produce a structured note folder.
//
// This only does anything inside the PaperReader desktop app (Electron), where
// a preload script exposes `window.top.paperBridge`. On the public GitHub Pages
// site there is no bridge, so this script is a complete no-op and the buttons
// stay hidden (CSS keeps `.read-btn { display: none }` until body.app-mode is
// added, which we only do once a bridge is found).
//
// Frames are same-origin (the report page is loaded in an iframe by the app
// shell), so the iframe reaches the top-frame bridge directly via window.top —
// the same trick like.js uses to read window.parent.sessionStorage. Progress
// flows the other way through the shell's renderer (it reaches into this iframe
// to update the originating card); we also subscribe to onProgress here so a
// card reflects its own job's state, and we restore state on (re)load via
// listJobs so switching days doesn't lose an in-flight read's button.

(function () {
  // Resolve the bridge defensively. The app may expose it on this very frame
  // (preload in all frames) or only on the top frame — prefer the local one,
  // fall back to window.top. window.top access can throw a SecurityError if the
  // page were ever framed cross-origin; on the public site both are undefined.
  // Either way → no bridge → no-op.
  let bridge = null;
  try {
    bridge = window.paperBridge || (window.top && window.top.paperBridge) || null;
  } catch {
    bridge = window.paperBridge || null;
  }
  if (!bridge) return; // public site / not in the app — leave buttons hidden

  // Reveal the .read-btn buttons (mirrors how like.js adds `zotero-mode`).
  document.body.classList.add("app-mode");

  const REPORT_FILE = location.pathname.split("/").pop() || "";

  function extractArxivIdLocal(url) {
    if (!url) return null;
    const m = url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:\.pdf)?$/i);
    return m ? m[1] : null;
  }

  function baseArxivId(id) {
    return id ? String(id).replace(/v\d+$/i, "") : null;
  }

  function readPapersData() {
    const tag = document.getElementById("papers-data");
    if (!tag) return [];
    try {
      return JSON.parse(tag.textContent);
    } catch (e) {
      console.error("[read] failed to parse #papers-data:", e);
      return [];
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

  // FontAwesome glyphs per visual state (the site loads FA6 solid).
  const ICONS = {
    idle: "fa-wand-magic-sparkles",
    queued: "fa-hourglass-half",
    running: "fa-spinner fa-spin",
    done: "fa-circle-check",
    read: "fa-book",
    error: "fa-triangle-exclamation",
  };

  // Render a button's visual state. `state` ∈ idle|queued|running|done|error.
  function setReadBtn(btn, state, labelText) {
    btn.dataset.state = state;
    btn.classList.toggle("running", state === "queued" || state === "running");
    btn.classList.toggle("done", state === "done");
    btn.classList.toggle("read", state === "read");
    btn.classList.toggle("error", state === "error");
    const icon = btn.querySelector(".read-icon");
    const label = btn.querySelector(".read-label");
    if (icon) {
      const glyph = state === "running" ? ICONS.running : ICONS[state] || ICONS.idle;
      icon.innerHTML = `<i class="fas ${glyph}"></i>`;
    }
    if (label) {
      label.textContent =
        labelText ||
        {
          idle: "帮我读",
          queued: "排队中",
          running: "读取中",
          done: "已生成",
          read: "笔记",
          error: "失败·重试",
        }[state] ||
        "帮我读";
    }
  }

  // Manual 已读 marker on a note-having card (B style: corner badge + left
  // accent). Source of truth is the note's checkbox; clicking writes it back via
  // the bridge (and Obsidian-side edits show up on next load). Independent of the
  // blue 笔记 (note-exists) button.
  function applyCardRead(card, read) {
    card.classList.toggle("paper-read", read);
    const t = card.querySelector(".read-mark-toggle");
    if (t) {
      t.innerHTML = read
        ? '<i class="fas fa-circle-check"></i> 已读'
        : '<i class="far fa-circle"></i> 标为已读';
    }
  }

  function markCardRead(btn, isRead) {
    const card = btn.closest(".bento-item, .filtered-item");
    if (!card) return;
    if (getComputedStyle(card).position === "static") card.style.position = "relative";
    if (!card.querySelector(".read-mark-foot")) {
      const foot = document.createElement("div");
      foot.className = "read-mark-foot";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "read-mark-toggle";
      foot.appendChild(toggle);
      card.appendChild(foot);

      const badge = document.createElement("span");
      badge.className = "read-mark-badge";
      badge.innerHTML = '<i class="fas fa-check"></i> 已读';
      card.appendChild(badge);

      toggle.addEventListener("click", () => {
        const next = !card.classList.contains("paper-read");
        applyCardRead(card, next); // optimistic
        Promise.resolve(bridge.setReadStatus(btn.dataset.notePath, next))
          .then((r) => {
            if (!r || !r.ok) {
              applyCardRead(card, !next); // revert on failure
              showToast(`标记失败：${(r && r.reason) || "未知错误"}`, "error");
            }
          })
          .catch((e) => {
            applyCardRead(card, !next);
            showToast(`标记失败：${e.message}`, "error");
          });
      });
    }
    applyCardRead(card, !!isRead);
  }

  // Map a normalized progress event → the button label shown while running.
  // phases come from app/stream-parser.js (mapEvent).
  function labelForPhase(evt) {
    if (evt.label) return evt.label; // parser already gives a Chinese phase line
    return (
      {
        init: "启动中",
        fetch: "抓取 PDF",
        text: "提取正文",
        figures: "处理图片",
        code: "拉取源码",
        read_image: "读图",
        write: "写笔记",
      }[evt.phase] || "读取中"
    );
  }

  const papers = readPapersData();
  // paperIndex (string) → button, so progress events can find their card.
  const btnByIndex = new Map();

  function startRead(btn, paper) {
    setReadBtn(btn, "queued");
    bridge
      .read({
        url: paper.url,
        title: paper.title,
        arxivId: extractArxivIdLocal(paper.url),
        paperIndex: btn.dataset.paperIndex,
        reportFile: REPORT_FILE,
      })
      .then((r) => {
        if (r && r.ok) {
          btn.dataset.jobId = r.jobId;
          setReadBtn(btn, "running");
        } else if (r && r.reason === "already-running") {
          if (r.jobId) btn.dataset.jobId = r.jobId;
          setReadBtn(btn, "running");
        } else {
          setReadBtn(btn, "idle");
          showToast(`启动失败：${(r && r.reason) || "未知错误"}`, "error");
        }
      })
      .catch((e) => {
        setReadBtn(btn, "idle");
        showToast(`启动失败：${e.message}`, "error");
      });
  }

  function onClick(btn, paper) {
    const state = btn.dataset.state || "idle";
    if (state === "queued" || state === "running") return; // dedup; cancel via sidebar
    if (state === "done") {
      if (btn.dataset.jobId) bridge.openInObsidian(btn.dataset.jobId);
      return;
    }
    if (state === "read") {
      // already read in a prior session → open the existing note
      if (btn.dataset.notePath) bridge.openNote(btn.dataset.notePath);
      return;
    }
    // idle or error → (re)start the read
    startRead(btn, paper);
  }

  // Reflect a job's progress on its originating button (this page only).
  function applyProgress(evt) {
    if (!evt) return;
    let btn = null;
    if (evt.jobId) {
      for (const b of btnByIndex.values()) {
        if (b.dataset.jobId === evt.jobId) {
          btn = b;
          break;
        }
      }
    }
    if (!btn && evt.reportFile === REPORT_FILE && evt.paperIndex != null) {
      btn = btnByIndex.get(String(evt.paperIndex));
    }
    if (!btn) return; // not a card on this page

    if (evt.jobId) btn.dataset.jobId = evt.jobId;
    switch (evt.state) {
      case "queued":
        setReadBtn(btn, "queued");
        break;
      case "running":
        setReadBtn(btn, "running", labelForPhase(evt));
        break;
      case "done":
        setReadBtn(btn, "done");
        break;
      case "error":
        setReadBtn(btn, "error");
        if (evt.label) showToast(`读取失败：${evt.label}`, "error");
        break;
      case "canceled":
        setReadBtn(btn, "idle");
        break;
      default:
        if (evt.phase) setReadBtn(btn, "running", labelForPhase(evt));
    }
  }

  // On live-fetched public pages the read button isn't in the HTML (it's the
  // app's addition, not the public site's). Inject its styles + a button next
  // to each translate button — every card has one, carrying data-paper-index —
  // so the feature works on any page the app loads without redeploying the site.
  function injectReadStyles() {
    if (document.getElementById("read-paper-styles")) return;
    const css =
      ".read-btn{display:inline-flex;align-items:center;gap:.45rem;margin-left:.6rem;padding:.5rem 1rem;font-size:.875rem;font-weight:600;font-family:inherit;color:#047857;background-color:rgba(5,150,105,.08);border:1px solid rgba(5,150,105,.22);border-radius:.5rem;cursor:pointer;text-decoration:none;transition:background-color .3s ease,color .3s ease,transform .2s ease;vertical-align:middle}" +
      ".read-btn:hover{background-color:rgba(5,150,105,.16);color:#065f46;transform:translateY(-1px)}" +
      ".read-btn .read-icon{display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;transition:transform .3s ease}" +
      ".read-btn:hover .read-icon{transform:scale(1.18) translateX(1px)}" +
      ".read-btn.running{color:#b45309;background-color:rgba(217,119,6,.1);border-color:rgba(217,119,6,.3);cursor:progress;animation:read-pulse 1.6s ease-in-out infinite}" +
      "@keyframes read-pulse{0%,100%{opacity:1}50%{opacity:.72}}" +
      ".read-btn.done{color:#fff;background:linear-gradient(135deg,#059669,#10b981);border-color:transparent;box-shadow:0 4px 12px rgba(5,150,105,.28)}" +
      ".read-btn.done:hover{filter:brightness(1.08);color:#fff}" +
      ".read-btn.read{color:#fff;background:linear-gradient(135deg,#2563eb,#3b82f6);border-color:transparent}" +
      ".read-btn.read:hover{filter:brightness(1.08);color:#fff}" +
      ".read-btn.error{color:#b91c1c;background-color:rgba(185,28,28,.08);border-color:rgba(185,28,28,.3)}" +
      ".read-btn-compact{padding:.32rem .7rem;font-size:.78rem;margin-left:.5rem}" +
      // app-only: widen the report (Tailwind .container caps at 768px in the ~1000px
      // iframe → big side margins). Raise the cap so cards use the width / less white.
      "body.container{max-width:1400px !important}" +
      // manual 已读 marker (B style): bottom toggle + corner badge + left accent
      ".read-mark-foot{margin-top:.85rem;padding-top:.7rem;border-top:1px dashed rgba(226,232,240,.9)}" +
      ".read-mark-toggle{font-family:inherit;font-size:.78rem;font-weight:600;display:inline-flex;align-items:center;gap:.4rem;padding:.35rem .85rem;border-radius:999px;border:1px solid rgba(203,213,225,.9);background:#fff;color:#64748b;cursor:pointer;transition:background-color .2s ease,color .2s ease,border-color .2s ease}" +
      ".read-mark-toggle:hover{border-color:#94a3b8;color:#475569}" +
      ".bento-item.paper-read,.filtered-item.paper-read{border-left:3px solid #10b981}" +
      ".paper-read .read-mark-toggle{border-color:transparent;background:rgba(5,150,105,.12);color:#047857}" +
      ".read-mark-badge{display:none;position:absolute;top:0;right:0;align-items:center;gap:.3rem;font-size:.66rem;font-weight:700;color:#047857;background:rgba(5,150,105,.14);padding:.2rem .6rem;border-bottom-left-radius:.6rem}" +
      ".paper-read .read-mark-badge{display:inline-flex}";
    const style = document.createElement("style");
    style.id = "read-paper-styles";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureReadButtons() {
    document.querySelectorAll(".translate-btn").forEach((tb) => {
      const idx = tb.dataset.paperIndex;
      if (idx == null) return;
      const card = tb.parentElement;
      if (card && card.querySelector('.read-btn[data-paper-index="' + idx + '"]')) return; // already present
      const btn = document.createElement("button");
      btn.className = "read-btn" + (tb.classList.contains("translate-btn-compact") ? " read-btn-compact" : "");
      btn.type = "button";
      btn.dataset.paperIndex = idx;
      btn.dataset.state = "idle";
      btn.title = "用本地 Claude 精读这篇并生成 Obsidian 笔记";
      btn.innerHTML =
        '<span class="read-icon"><i class="fas fa-wand-magic-sparkles"></i></span><span class="read-label">帮我读</span>';
      tb.insertAdjacentElement("afterend", btn);
    });
  }

  function init() {
    injectReadStyles();
    ensureReadButtons();
    document.querySelectorAll(".read-btn").forEach((btn) => {
      const idx = parseInt(btn.dataset.paperIndex, 10);
      const paper = papers[idx];
      if (!paper) {
        btn.style.display = "none";
        return;
      }
      btnByIndex.set(String(idx), btn);
      setReadBtn(btn, "idle");
      btn.addEventListener("click", () => onClick(btn, paper));
    });

    // Progress is owned by the top-frame renderer (single IPC surface): it
    // pushes each event into this iframe by calling __readPaperApply, rather
    // than us subscribing across frames. Expose the hook for it.
    window.__readPaperApply = applyProgress;
    window.__readPaperReportFile = REPORT_FILE;
    // If the bridge lives on THIS frame (all-frames preload), also subscribe
    // directly — harmless and covers that config too.
    if (window.paperBridge && window.paperBridge.onProgress) {
      window.paperBridge.onProgress(applyProgress);
    }

    // Restore button state for jobs already running/finished for THIS report,
    // so switching days (which reloads this iframe) doesn't drop their state.
    if (bridge.listJobs) {
      Promise.resolve(bridge.listJobs())
        .then((jobs) => {
          (jobs || []).forEach((job) => {
            if (job.reportFile !== REPORT_FILE) return;
            const btn = btnByIndex.get(String(job.paperIndex));
            if (!btn) return;
            btn.dataset.jobId = job.id;
            applyProgress({
              jobId: job.id,
              paperIndex: job.paperIndex,
              reportFile: job.reportFile,
              state: job.state,
              phase: job.phase,
              label: job.label,
            });
          });
        })
        .catch(() => {});
    }

    // Mark papers already read in a PRIOR session (a note exists in the local
    // vault) as 已读 — clicking opens that note instead of re-reading. Only marks
    // idle buttons so a live job's state isn't clobbered. Cross-device is the
    // user's own Obsidian sync; we only read this machine's vault.
    if (bridge.readPapers) {
      Promise.resolve(bridge.readPapers())
        .then((map) => {
          if (!map) return;
          btnByIndex.forEach((btn, idxStr) => {
            if (btn.dataset.state !== "idle") return;
            const paper = papers[parseInt(idxStr, 10)];
            if (!paper) return;
            const id = baseArxivId(extractArxivIdLocal(paper.url));
            const entry = id && map[id];
            if (entry) {
              btn.dataset.notePath = entry.rel;
              setReadBtn(btn, "read"); // blue 笔记 button (opens the note)
              markCardRead(btn, entry.read); // manual 已读 marker (from the note's checkbox)
            }
          });
        })
        .catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
