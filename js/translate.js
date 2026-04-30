// Wires up the "翻译" buttons that hand a paper off to hjfy.top for full
// Chinese translation.
//
// Current behavior:
//   1. Open hjfy.top in a new tab.
//   2. Copy the arXiv URL to the clipboard so the user can paste-and-go.
//
// Upgrade path: once we know hjfy.top's URL pattern for triggering an
// automatic translation (e.g. https://hjfy.top/translate?url=<arxivUrl>),
// switch HJFY_DEEP_LINK below to a function returning that URL — the rest
// of the flow stays identical.

(function () {
  // hjfy.top auto-translates when the arXiv ID is appended to /arxiv/.
  // E.g. https://hjfy.top/arxiv/2604.24681v1
  const HJFY_BASE = "https://hjfy.top";
  const HJFY_DEEP_LINK = (arxivUrl) => {
    const id = extractArxivIdLocal(arxivUrl);
    return id ? `${HJFY_BASE}/arxiv/${id}` : null;
  };

  function extractArxivIdLocal(url) {
    if (!url) return null;
    const m = url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:\.pdf)?$/i);
    return m ? m[1] : null;
  }

  function readPapersData() {
    const tag = document.getElementById("papers-data");
    if (!tag) return [];
    try {
      return JSON.parse(tag.textContent);
    } catch (e) {
      console.error("[translate] failed to parse #papers-data:", e);
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

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback for browsers that block writeText() in some contexts.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch (e2) {
        console.warn("[translate] clipboard fallback failed:", e2);
        return false;
      }
    }
  }

  async function handleClick(paper) {
    const arxivUrl = paper.url || "";
    const deepLink = HJFY_DEEP_LINK(arxivUrl);

    if (deepLink) {
      // hjfy.top auto-starts translation when given /arxiv/<id>.
      window.open(deepLink, "_blank", "noopener");
      return;
    }

    // Couldn't extract an arXiv ID — fall back to clipboard + homepage flow.
    const copied = await copyToClipboard(arxivUrl);
    window.open(HJFY_BASE, "_blank", "noopener");
    if (copied) {
      showToast("链接已复制，在 hjfy.top 粘贴即可翻译", "success");
    } else {
      showToast(`请手动复制到 hjfy.top：${arxivUrl}`, "info");
    }
  }

  function init() {
    const papers = readPapersData();
    const buttons = document.querySelectorAll(".translate-btn");

    buttons.forEach((btn) => {
      const idx = parseInt(btn.dataset.paperIndex, 10);
      const paper = papers[idx];
      if (!paper) {
        btn.style.display = "none";
        return;
      }
      btn.addEventListener("click", () => handleClick(paper));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
