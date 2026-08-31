# PaperReader — refresh · calendar popover · search panel · 读论文 Zotero

> **Superseded historical design (v0.2).** This document describes the retired
> browser credential/WebDAV implementation and must not be used as v0.3.0 setup
> or security guidance. PaperReader v0.3.0 is App-only for Zotero and stores each
> user's key locally through operating-system-protected storage. See the root
> README and `app/README.md` for the supported workflow.

Date: 2026-06-15. Approved by user ("可以，就对这些全量实现"). App-only + shared `js/`
changes; **do not touch** `templates/`, `daily_html/`, `reports.json`.

## Features

### 1. Manual refresh (standalone)
- Refresh icon-button in topbar right cluster (between 读论文 and ⚙ settings).
- Click → `loadReports({keep: current})` (rebuild date list/calendar, keep current
  date) + reload current report iframe (the `app://` proxy always hits network
  first, so this pulls latest content) + `refreshEnv()`. Spin icon while working.
  Toast "发现 N 个新报告" if report count grew.

### 2. Calendar popover — merges 「论文列表」into the date pill
- Date pill click opens a calendar popover (replaces the native `<select>` dropdown
  UX). Month grid, ‹ › month nav, report-days highlighted (purple `#f3e8ff`),
  current day filled (`#7b2c9f`), empty days muted, "跳到最新" shortcut. Pick a day →
  switch that report in place + close. Topbar ‹ › day-arrows keep working.
- Keep a hidden `<select id="report-select">` as the index model so existing
  prev/next-day logic (`select.selectedIndex`) is untouched; calendar drives it.
- Pure logic in NEW `app/calendar.js` (TDD): `reportDateMap(reports)`,
  `monthMatrix(year, month0, dateMap)` → weeks of `{day,key,inMonth,file}`,
  `latestReport`, `monthsWithReports` (nav bounds).

### 3. Search panel — 「查找文献」next to 读论文
- 搜索 button in topbar right opens a modal overlay (`#search-overlay`) with
  MiniSearch box + results — same engine/fields as web `search.html`.
- `search_index.json` (~83 MB) lazy-loaded on first open via `app://` proxy:
  add to `isLiveData()` in main.js; bump that path's fetch timeout (6 s → 120 s).
  NOT bundled (too big) — live + userData cache + graceful offline error.
- MiniSearch vendored: `app/vendor/minisearch.min.js` (global `MiniSearch`).
- Each result: title/date/authors/tldr/topic/score PLUS
  - 帮我读 (always) → `bridge.read({url,title,arxivId})`; state via `onProgress`
    (match jobId); progress also in right sidebar.
  - 加入 Zotero (personal mode only) → `ZoteroSave.add(paper)`; index entry already
    carries {title, authors, url, summary, date→published, categories}.

### 4. Shared Zotero save (app-side) + 读论文 modal button
- NEW `app/zotero-save.js` (app-only; loaded by shell). `window.ZoteroSave.fromSession(session)`
  → saver with `add(paper)`, `remove(itemKey)`, `client`, `listAddedMap(rootName)`.
  Replicates like.js's flow (getOrCreateTodayCollection → createPreprintItem →
  tryUploadPdf via worker proxy + WebDAV, else linked_url). Used by search panel +
  read modal. **like.js and templates/ untouched** (template is off-limits; so we
  duplicate the ~80-line flow rather than make like.js depend on a new shared file).
- Shell loads (shell.html): `vendor/spark-md5.min.js`, `vendor/jszip.min.js`,
  `vendor/minisearch.min.js`, `site/js/zotero.js`, `site/js/webdav.js`,
  `zotero-save.js` (+ existing crypto.js, secrets.enc.js). app://local can do the
  cross-origin Zotero/WebDAV/proxy fetches (the report iframe already does).
- 读论文 modal: two actions 「开读」/「加入 Zotero」. 加入 Zotero enabled only for an
  arxiv link/ID (and personal mode); name-query → disabled + hint (no id until read
  resolves it). Uses NEW IPC `arxiv:meta(idOrUrl)` (main process `net.fetch`
  export.arxiv.org Atom, no CORS) → build paper → `ZoteroSave.add`.
- NEW `app/arxiv-meta.js` (TDD): `arxivIdFromInput(s)`, `parseArxivAtom(xml, id)` →
  `{title, summary, published, authors, categories, url}`.

## Files
- app/main.js — `isLiveData` + search_index.json timeout; `arxiv:meta` IPC.
- app/preload.js — expose `arxivMeta`.
- app/shell.html — refresh + search buttons; calendar popover; search overlay;
  read-modal 2nd button; shell toast styles; new script includes.
- app/renderer.js — refresh; calendar popover (uses calendar.js); search panel
  (lazy index, render, result actions); read-modal Zotero; shell toast.
- app/calendar.js (NEW, TDD) · app/arxiv-meta.js (NEW, TDD) · app/zotero-save.js (NEW).
- app/vendor/{minisearch,spark-md5,jszip}.min.js (NEW, vendored).
- Tests: test/calendar.test.js, test/arxiv-meta.test.js (node --test, explicit files).

## Build order
① refresh → ② calendar (+calendar.js TDD) → ③ zotero-save + arxiv-meta (TDD) +
read-modal button → ④ search panel.

## Verify
- `node --test test/calendar.test.js test/arxiv-meta.test.js` green.
- Smoke: `PAPERREADER_SMOKE` screenshot (topbar shows refresh+search), plus
  `PAPERREADER_SMOKE_TAB`-style probes for popover/search overlay open + report intact.
- Personal-mode manual spot-check for search/read Zotero add (needs creds+network).
