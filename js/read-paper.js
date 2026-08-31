// Wires up the "帮我读" buttons that hand a paper off to the configured local
// AI CLI to deep-read it with the paper-reading skill (in the Obsidian vault) and
// produce a structured note folder.
//
// This only does anything inside the PaperReader desktop app (Electron). A
// same-frame preload bridge is preferred when present; sandboxed report frames
// use PaperReaderReportBridge, a narrow postMessage RPC supplied by app-rpc.js.
// On the public GitHub Pages site neither app bridge is enabled, so this script
// is a complete no-op and the buttons stay hidden.

(function () {
  // Never inspect window.top: sandboxed reports can have an opaque origin and
  // the privileged Electron preload surface intentionally exists only in the
  // shell's main frame.
  const reportBridge = window.PaperReaderReportBridge;
  const bridge =
    window.paperBridge ||
    (reportBridge && reportBridge.appEnabled ? reportBridge : null);
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

  function readSvg(name, body, spinning = false) {
    return (
      `<svg class="read-svg-icon${spinning ? " read-svg-icon-spin" : ""}" ` +
      `data-read-icon="${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
      `${body}</svg>`
    );
  }

  // Self-contained icons keep report controls crisp under the App's strict
  // `font-src 'none'` CSP and avoid a hidden dependency on a CDN webfont.
  const ICONS = {
    idle: readSvg(
      "wand",
      '<path d="M4 20L15.5 8.5M13.5 6.5l4 4M18 2v3M16.5 3.5h3M6 5v4M4 7h4M18.5 15v4M16.5 17h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
    ),
    queued: readSvg(
      "queued",
      '<path d="M7 3h10M7 21h10M8 3c0 4 1.25 6.1 4 8-2.75 1.9-4 4-4 8m8-16c0 4-1.25 6.1-4 8 2.75 1.9 4 4 4 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
    ),
    running: readSvg(
      "running",
      '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="40 14"/>',
      true
    ),
    done: readSvg(
      "done",
      '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8 12 2.6 2.6L16.5 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    ),
    read: readSvg(
      "book",
      '<path d="M4 5.5c2.7-.8 5.4-.25 8 1.6v13c-2.6-1.85-5.3-2.4-8-1.6zM20 5.5c-2.7-.8-5.4-.25-8 1.6v13c2.6-1.85 5.3-2.4 8-1.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'
    ),
    error: readSvg(
      "error",
      '<path d="M12 3 2.8 20h18.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8v5m0 3.2v.1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
    ),
    checked: readSvg(
      "checked",
      '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8 12 2.6 2.6L16.5 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    ),
    unchecked: readSvg(
      "unchecked",
      '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    ),
    check: readSvg(
      "check",
      '<path d="m5.5 12.5 4 4L18.5 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
    ),
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
      icon.innerHTML = ICONS[state] || ICONS.idle;
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
        ? `${ICONS.checked} 已读`
        : `${ICONS.unchecked} 标为已读`;
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
      badge.innerHTML = `${ICONS.check} 已读`;
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
      ".read-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:.5rem;min-height:var(--report-action-height,42px);margin:.4rem .45rem 0 0;padding:.55rem .95rem;font-size:.875rem;font-weight:600;line-height:1.25;font-family:inherit;color:#047857;background-color:rgba(5,150,105,.08);border:1px solid rgba(5,150,105,.22);border-radius:.5rem;cursor:pointer;text-decoration:none;transition:background-color .18s ease,color .18s ease,transform .18s ease;vertical-align:middle;white-space:nowrap}" +
      ".read-btn:hover{background-color:rgba(5,150,105,.16);color:#065f46;transform:translateY(-1px)}" +
      ".read-btn .read-icon{display:inline-flex;align-items:center;justify-content:center;width:var(--report-action-icon-size,18px);height:var(--report-action-icon-size,18px);flex:0 0 var(--report-action-icon-size,18px);transition:transform .18s ease}" +
      ".read-svg-icon{display:block;width:1em;height:1em;overflow:visible;flex:0 0 auto}" +
      ".read-icon>.read-svg-icon{width:100%;height:100%}" +
      ".read-svg-icon-spin{animation:read-icon-spin .8s linear infinite}" +
      "@keyframes read-icon-spin{to{transform:rotate(360deg)}}" +
      ".read-btn:hover .read-icon{transform:scale(1.18) translateX(1px)}" +
      ".read-btn.running{color:#b45309;background-color:rgba(217,119,6,.1);border-color:rgba(217,119,6,.3);cursor:progress}" +
      ".read-btn.done{color:#fff;background:linear-gradient(135deg,#059669,#10b981);border-color:transparent;box-shadow:0 4px 12px rgba(5,150,105,.28)}" +
      ".read-btn.done:hover{filter:brightness(1.08);color:#fff}" +
      ".read-btn.read{color:#fff;background:linear-gradient(135deg,#2563eb,#3b82f6);border-color:transparent}" +
      ".read-btn.read:hover{filter:brightness(1.08);color:#fff}" +
      ".read-btn.error{color:#b91c1c;background-color:rgba(185,28,28,.08);border-color:rgba(185,28,28,.3)}" +
      ".read-btn-compact{min-height:var(--report-compact-height,36px);padding:.42rem .72rem;font-size:.8rem;margin:.3rem .4rem 0 0}" +
      ".read-btn-compact .read-icon{width:var(--report-compact-icon-size,16px);height:var(--report-compact-icon-size,16px);flex-basis:var(--report-compact-icon-size,16px)}" +
      // manual 已读 marker (B style): bottom toggle + corner badge + left accent
      ".read-mark-foot{margin-top:.85rem;padding-top:.7rem;border-top:1px dashed rgba(226,232,240,.9)}" +
      ".read-mark-toggle{box-sizing:border-box;min-height:var(--report-compact-height,36px);font-family:inherit;font-size:.8rem;font-weight:600;line-height:1.2;display:inline-flex;align-items:center;gap:.4rem;padding:.4rem .85rem;border-radius:999px;border:1px solid rgba(203,213,225,.9);background:#fff;color:#64748b;cursor:pointer;transition:background-color .18s ease,color .18s ease,border-color .18s ease}" +
      ".read-mark-toggle>.read-svg-icon{width:var(--report-compact-icon-size,16px);height:var(--report-compact-icon-size,16px)}" +
      ".read-mark-toggle:hover{border-color:#94a3b8;color:#475569}" +
      ".bento-item.paper-read,.filtered-item.paper-read{border-left:3px solid #10b981}" +
      ".paper-read .read-mark-toggle{border-color:transparent;background:rgba(5,150,105,.12);color:#047857}" +
      ".read-mark-badge{display:none;position:absolute;top:0;right:0;align-items:center;gap:.3rem;font-size:.66rem;font-weight:700;color:#047857;background:rgba(5,150,105,.14);padding:.2rem .6rem;border-bottom-left-radius:.6rem}" +
      ".read-mark-badge>.read-svg-icon{width:14px;height:14px}" +
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
      btn.title = "用本地 AI CLI 精读这篇并生成 Obsidian 笔记";
      btn.innerHTML =
        `<span class="read-icon">${ICONS.idle}</span><span class="read-label">帮我读</span>`;
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

    // Keep the legacy direct hook for same-frame integrations, and subscribe to
    // the active bridge so sandboxed reports receive shell-relayed events too.
    window.__readPaperApply = applyProgress;
    window.__readPaperReportFile = REPORT_FILE;
    if (bridge.onProgress) {
      bridge.onProgress(applyProgress);
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
      const reportBaseIds = papers
        .map((paper) => baseArxivId(extractArxivIdLocal(paper && paper.url)))
        .filter(Boolean);
      Promise.resolve(bridge.readPapers(reportBaseIds))
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
