# v0.3 — PaperReader desktop app (一键「帮我读」+ 已读标记)

## TL;DR

A cross-platform **Electron desktop app** (`app/`, Windows + macOS) wraps the
daily-papers site and drives your **local Claude Code subscription** to
deep-read any candidate paper with the `paper-reading` skill — generating a
structured Obsidian note straight from the paper list. It live-fetches the
latest papers on launch (no git pull), marks papers already read in your local
vault, and unlocks the existing Zotero controls in-app. The public GitHub Pages
site is unchanged — the read button is the app's own injection and never
appears there. The app is local-only and adds **no new repository secrets**.

> macOS support ships in the code; verify on a Mac (or via the CI workflow)
> before relying on it.

---

## Highlights

### Desktop app (new)

- **「帮我读」 per paper.** A button on every candidate spawns the local `claude`
  CLI (`--permission-mode bypassPermissions`, subscription OAuth — never an API
  key) with the vault's `paper-reading` skill to deep-read the paper and write a
  structured note folder `<vault>/<date>/<title>/`. Live stream-json progress in a
  sidebar; "open folder / open in Obsidian" on finish; a bounded job queue with
  cancel + a watchdog.
- **Always-latest data, no git pull.** A custom `app://` protocol live-fetches
  `reports.json` + report pages from the published site on each load (cached to
  userData for offline; bundled snapshot as last resort), and injects the read
  button into the fetched pages — so the public site needs no change.
- **Already-read markers.** On load the app scans the **local** vault for existing
  notes and shows those papers as **✓ 已读** → click opens the note. Cross-device
  is your own Obsidian sync; the app only ever reads this machine.
- **Zotero unlock in-app.** A launch password overlay decrypts the same
  `secrets.enc.js` bundle as the public gate, enabling "Add to Zotero" inside the
  app (or skip it for read-only).
- **Settings + packaging.** Configurable vault/claude paths, model
  (default `opus`), concurrency (default 10), per-read budget cap, and data
  source. Installers build via `electron-builder` — Windows `.exe` locally; macOS
  `.dmg` via the `Build PaperReader app` GitHub Actions workflow.

### Skill / notes

- **paper-reading diagrams reworked.** The skill now draws a **skeleton** overview
  pipeline (collapse repeated structure, ≤ ~12 nodes), wraps it in a collapsed
  callout, and color-codes stages — so the Mermaid diagram fits the note width and
  stops dominating the page. A `mermaid-fit` Obsidian CSS snippet makes existing
  diagrams responsive too.

---

## Notes

- The desktop app is **local-only** — it drives this machine's Claude
  subscription and Obsidian vault, and is not part of the public site. Build
  artifacts (`app/dist`, `app/node_modules`, `app/site`) are git-ignored.
- No new repository secrets. The app reuses the existing encrypted Zotero bundle
  for its optional in-app unlock.

---

## 中文摘要

v0.3 新增**桌面应用 PaperReader**（`app/`，Windows + macOS）：在每日论文列表里一键
**「帮我读」**——调用你**本地 Claude Code 订阅** + vault 里的 `paper-reading` 技能
深读论文并生成结构化 Obsidian 笔记；启动 **live-fetch 最新论文**（无需 git pull）、
标记本机 vault 里**已读**的论文、应用内解锁 **Zotero**。公网站点零改动（读按钮是 app
自己注入，公开站不显示），且不新增任何仓库 secret。另：`paper-reading` 技能的总览流程图
改为**骨架化 + 折叠 + 上色**，不再占篇幅、自适应宽度。macOS 端代码已就绪，上线前请在
Mac（或 CI）实测。

---

# v0.2 — Personal Mode + Zotero/WebDAV + UI Overhaul

## TL;DR

The site gains an optional **personal mode**, gated by a site password, that
adds one-click Zotero collection and WebDAV-backed PDF auto-upload. The
filter pipeline gains a standalone Stage-1 rescoring tool. All entry pages
and the daily report template are redesigned. Documentation is rewritten
in formal style with a setup walkthrough.

The public site continues to function as before in guest-only mode without
any of the new secrets configured.

---

## Highlights

### Personal mode (new)

- **Site-password gate.** A site-wide passphrase decrypts a per-fork
  Zotero credentials bundle stored client-side at `js/secrets.enc.js`
  (AES-GCM, 600 000-iteration PBKDF2-SHA256 over `SITE_PASSWORD`). The
  bundle is regenerated on every workflow run and force-pushed past
  `.gitignore`.
- **One-click Zotero collection.** A per-paper "Add to Zotero" control
  writes a typed `preprint` item (with arXiv DOI, authors, abstract) into
  a `Daily Paper / YYYY-MM-DD` collection, created on demand.
- **WebDAV PDF upload.** The arXiv PDF is fetched through a Cloudflare
  Worker (CORS bypass), wrapped in Zotero's `<key>.zip` + `<key>.prop`
  format, and PUT to the user's existing Zotero WebDAV server. After the
  next desktop sync, the file opens locally without further action.
- **arXiv-to-bilingual translation.** A per-paper button opens
  [hjfy.top](https://hjfy.top) with the relevant arXiv ID for bilingual
  reading. The deep-link requires a prior login at hjfy.top in the same
  browser session; without authentication the request is redirected to
  the hjfy.top homepage. The translation button is exposed in **both
  guest and personal modes** — hjfy.top credentials are managed entirely
  by hjfy.top and are not part of this project's secrets.

### UI overhaul

- All entry pages (`index`, `personal`, `guest`, `list`, `search`)
  redesigned with a unified glass-morphism language, gradient accents,
  and icon-led navigation.
- Daily report cards now use **bold, larger Chinese summaries and TLDRs**
  for at-a-glance scanning.
- The daily template's redundant inline quick-nav is removed; navigation
  is now provided by the iframe parent only.
- All 149 historical daily reports are regenerated under the new template.

### Filter pipeline

- New tool [`src/rescore_stage1.py`](src/rescore_stage1.py) re-applies
  the current keyword taxonomy to every historical JSON file without
  invoking the LLM, allowing retroactive policy changes at zero API cost.
- Filter configuration extracted into [`src/config.py`](src/config.py)
  for clarity and easier downstream tuning.
- Stage-1 keyword tiers (Tier-0 core / Tier-1 strong / Tier-2 weak /
  Tier-3 hard exclude) refined for higher recall on borderline robotics
  papers. See [Tuning the filter](README.md#tuning-the-filter).

### Documentation

- README fully rewritten in formal style; both English
  ([`README.md`](README.md)) and Chinese
  ([`README_ZH.md`](README_ZH.md)) versions are now feature-complete and
  in sync.
- Cover image added.
- Quick-start path documented for GitHub-only deployment (no local
  environment required apart from the Cloudflare Worker).

---

## Breaking changes

- **`js/secrets.enc.js` is now `.gitignore`d.** Forks that previously
  committed the bundle should drop it; the workflow regenerates and
  force-adds it on every run.
- **Daily template structure changed.** TLDR ordering was revised and
  the inline `.quick-nav` block was removed. Forks with custom CSS
  targeting `.quick-nav` should adjust.
- **Three new repository secrets** are required to enable WebDAV PDF
  upload: `WEBDAV_URL`, `WEBDAV_USER`, `WEBDAV_PASS`. Without them the
  personal mode falls back to "link only" — Zotero items are created but
  no PDF is attached. None of these are required for guest mode.

---

## Migration (existing forks)

1. Pull `v0.2`.
2. Register the new repository secrets — see
   [Configuration](README.md#configuration).
3. Deploy the Cloudflare Worker (≈3 minutes, copy-paste). Set
   `PDF_PROXY_URL`. See [Cloudflare Worker](README.md#cloudflare-worker).
4. Re-run the workflow once. This will regenerate `js/secrets.enc.js`
   and refresh the historical daily reports under the new template.

If none of the personal-mode secrets are configured, the site continues
to function in guest-only mode without any modification.

---

## Quick start (new users)

The full stack runs on GitHub Actions; no local environment is required.
The only out-of-GitHub step is deploying a Cloudflare Worker. See
[Quick start](README.md#quick-start-github-only-deployment) for the
seven-step walkthrough.

---

## Commits

- `76be3a3` — chore: ignore `.claude/` worktrees and encrypted credentials bundle
- `83ca570` — feat(filter): two-stage rescoring pipeline + config extraction
- `8e9cf0c` — feat: personal mode with Zotero + WebDAV PDF upload, UI overhaul
- `94e3c75` — docs: rewrite README in formal style + add cover image

---

## 中文摘要

v0.2 在保持每日 arXiv 自动摘要核心流程的基础上，新增**个人模式**：

- 站点密码门控的 **Zotero 一键收藏 + WebDAV PDF 自动上传**（AES-GCM
  加密 bundle，PBKDF2-SHA256 600k 次迭代）
- 接入 [hjfy.top](https://hjfy.top) 的 **arXiv 中英对照** 翻译跳转
  （访客与个人模式均可用，需先在 hjfy.top 登录）
- **全站 UI 升级** —— 玻璃拟态语言，卡片中文摘要 / TLDR 加粗
- 过滤流程新增 **Stage-1 重打分工具**，可零 LLM 成本回溯调整关键词策略

升级现有 fork 需补三个 WebDAV secret 并部署 Cloudflare Worker；不部署
时仍以访客模式运行，全部内容可读。详见
[README_ZH.md](README_ZH.md)。
