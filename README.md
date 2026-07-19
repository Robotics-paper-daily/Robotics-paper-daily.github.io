# Robotics Daily Papers
![](cover.png)

> If you also want a zero-server-cost paper-summary site that continuously updates for your own research field, feel free to **Star + Fork** this repository and customize the keywords and topic categories as needed. Deployment only requires an additional Cloudflare Worker; it works out of the box and can be set up in five minutes~

This is an automated daily digest of robotics papers from arXiv. A scheduled GitHub Actions workflow ingests new submissions in `cs.RO`, `cs.AI`, `cs.CV`, and `cs.LG`, applies a two-stage filter (keyword prefilter followed by LLM rating), classifies each paper along four research lines — **VLA**, **World (Action) Models**, **Autonomous Driving**, **Embodied Intelligence** — and renders a static site published via GitHub Pages.

We also offer an optional **personal mode**, gated by a site password, adds one-click "Add to Zotero" with PDF auto-upload to a WebDAV-backed library, plus an arXiv-to-bilingual translation deep-link via [hjfy.top](https://hjfy.top).

New in **v0.3**: a cross-platform **desktop app** ([`app/`](app/README.md), Windows + macOS) adds a one-click **「帮我读」** that drives your *local* Claude Code subscription to deep-read any paper straight from the list into a structured Obsidian note — plus already-read markers and always-latest data. The public site is unaffected.

---

## Features

### Daily pipeline (always on)

1. **Ingestion** — arXiv API client with retry and exponential backoff for HTTP 429.
2. **Two-stage filter**
    - *Stage 1 (keyword prefilter, no LLM):* a four-tier keyword taxonomy (Tier-0 core, Tier-1 strong support, Tier-2 weak context, Tier-3 hard exclude), defined in [src/config.py](src/config.py). Title hits are weighted higher than abstract hits; `cs.RO`/`cs.AI` contribute a category bonus; Tier-3 hits force rejection. Word-boundary regex with light plural tolerance avoids substring collisions.
    - *Stage 2 (LLM rating, DeepSeek):* survivors receive integer scores in `[1, 10]` for `relevance`, `novelty`, `clarity`, `potential_impact`, and `overall_priority`; one topic label from `{VLA, WorldModel, AutonomousDriving, VLN, Manipulation, Locomotion, HumanoidEmbodied, RLRobot, Perception3D, Other}`; short keyword tags; bilingual TLDRs. Few-shot calibration examples in the prompt stabilize the score distribution.
3. **JSON archive** — date-keyed records in `daily_json/` containing title, abstract, link, scores, topic, keywords, and Stage-1 breakdown.
4. **HTML rendering** — Jinja2 template ([templates/paper_template.html](templates/paper_template.html)) produces three sections per day: headline (`overall ≥ 6`), low-score (`< 6`), and Stage-1 rejected. Topic labels render as colored chips.
5. **Continuous deployment** — workflow at [.github/workflows/daily_arxiv.yml](.github/workflows/daily_arxiv.yml).
6. **Backfill** — missing dates in `daily_json/` are detected and processed in batches via `--backfill --backfill-limit N`.
7. **Stage-1 rescoring** — [src/rescore_stage1.py](src/rescore_stage1.py) re-applies the current keyword taxonomy to all historical JSON without invoking the LLM, allowing retroactive policy changes at zero API cost.
8. **Full-text search** — client-side [MiniSearch](https://lucaong.github.io/minisearch/) index over titles, abstracts, TLDRs, and authors with AND-matching. The complete history is stored in size-bounded monthly shards so the daily workflow never creates a file above GitHub's 100 MiB limit.

### Personal mode (optional, password-gated)

9. **Zotero integration** — a per-paper "Add to Zotero" control writes a typed `preprint` item (with arXiv DOI, authors, abstract) into a `Daily Paper / YYYY-MM-DD` collection, created on demand.
10. **WebDAV PDF + LaTeX source upload** — the arXiv PDF *and* the LaTeX source archive (`https://arxiv.org/e-print/<id>`) are fetched through a Cloudflare Worker (CORS bypass), wrapped in Zotero's `<key>.zip` + `<key>.prop` format, and PUT to the user's WebDAV server. After the next desktop sync, both files are locally available without further action. The source upload is best-effort and capped at 50 MB; PDF-only submissions are detected (via `%PDF` magic) and skip source automatically.
11. **Translation** — a per-paper button opens [hjfy.top](https://hjfy.top) with the relevant arXiv ID for bilingual reading. The deep-link requires a prior login at hjfy.top in the same browser session; without authentication the request is redirected to the hjfy.top homepage. The translation button is exposed in both guest and personal modes — hjfy.top credentials are managed entirely by hjfy.top and are not part of this project's secrets.
12. **Default to guest mode** — the public site exposes all content but suppresses action buttons. Personal features unlock only after the password gate decrypts the credentials bundle.

### Desktop app — PaperReader (v0.3, optional)

A cross-platform Electron app ([`app/`](app/README.md), Windows + macOS) that drives your **local Claude Code subscription** to read papers straight from the daily list. The public site is unchanged — these controls are the app's own injection and never appear there.

13. **「帮我读」 (read this for me)** — a per-paper button spawns your local `claude` CLI with the `paper-reading` skill (in your Obsidian vault) to deep-read the paper and generate a structured note folder, with live progress in a sidebar and an "open in Obsidian" finish. Uses your subscription (OAuth), never an API key.
14. **Already-read markers** — papers whose note already exists in your local vault show a **✓ 已读** button that opens the existing note instead of re-reading. Cross-device is your own Obsidian sync; the app only ever reads this machine.
15. **Always-latest, no git pull** — the app live-fetches `reports.json` + report pages from the published site on launch (offline-cached), so every device shows the newest papers without pulling the repo.
16. **Zotero in-app** — the same password gate unlocks personal mode inside the app, so the report's "Add to Zotero" buttons work there too.

See [app/README.md](app/README.md) for prerequisites, run/build, and settings.

---

## Quick start (GitHub-only deployment)

The full stack runs on GitHub Actions; no local environment is required. The only out-of-GitHub step is deploying a Cloudflare Worker (≈3 minutes, copy-paste).

1. Fork this repository.
2. **Settings → Pages**: source = "Deploy from a branch", branch = `main`, folder = `/`.
3. Prepare the secrets listed in the [Configuration](#configuration) section. Only `DEEPSEEK_API_KEY` is required; the rest are optional and enable progressively richer features.
4. *(Personal mode only)* Deploy the Cloudflare Worker — see [Cloudflare Worker](#cloudflare-worker).
5. **Settings → Secrets and variables → Actions**: register each secret.
6. **Actions → Daily arXiv Paper Fetch and Filter → Run workflow** to trigger the first build.
7. After the workflow completes (typically 3–5 minutes), the site is live at `https://<username>.github.io/<repo>/`. Subsequent updates run daily at `00:00 UTC` (`08:00` Beijing).

Local development is documented in [Local development](#local-development) but is not required for deployment.

---

## Configuration

All credentials are passed via environment variables (locally) or repository secrets (on GitHub Actions). Optional fields can be omitted independently; the front-end degrades gracefully when any are absent.

| Secret | Required for | Notes |
|---|---|---|
| `DEEPSEEK_API_KEY` | Filter pipeline | Stage-2 LLM rating |
| `ZOTERO_API_KEY`   | Personal mode  | 24-character Zotero API key with read+write permissions |
| `ZOTERO_USER_ID`   | Personal mode  | Numeric user ID from `zotero.org` |
| `SITE_PASSWORD`    | Personal mode  | Site-wide passphrase (≥ 8 characters) used to encrypt the bundle |
| `PDF_PROXY_URL`    | Personal mode  | Cloudflare Worker URL |
| `WEBDAV_URL`       | PDF upload     | Full directory including the `/zotero/` subpath used by Zotero desktop |
| `WEBDAV_USER`      | PDF upload     | Basic-auth username |
| `WEBDAV_PASS`      | PDF upload     | Basic-auth password |

When `ZOTERO_API_KEY`, `ZOTERO_USER_ID`, or `SITE_PASSWORD` is absent, the `Build encrypted Zotero credentials bundle` workflow step writes a disabled placeholder at `js/secrets.enc.js`; the site continues to function in guest-only mode without error.

The Stage-2 LLM defaults to DeepSeek via the SJTU mirror — see [src/filter.py](src/filter.py). Any OpenAI-compatible endpoint is supported by editing the base URL and model identifier in that file.

---

## Personal mode setup

### Zotero credentials

1. At [zotero.org](https://www.zotero.org/), navigate to *Settings → Feeds/API*.
2. Create a new private key with `Allow library access`, `Allow notes access`, and `Allow write access`.
3. Record the 24-character API key and the numeric user ID displayed on the same page.

### WebDAV (optional)

WebDAV-backed storage is recommended for libraries that exceed Zotero's 300 MB free quota. Required values:

- **WebDAV URL** — must match the directory used by Zotero desktop, including the `/zotero/` subpath that the desktop client appends. Verify under *Edit → Preferences → Sync → File Syncing*. Example: `https://mori.teracloud.jp/dav/zotero`.
- **Username** — typically the account username.
- **Password** — for several providers (TeraCloud, Synology) this is a separate WebDAV-only password generated in the provider's settings, not the account login password.

If WebDAV is omitted, the "Add to Zotero" control still creates the parent item but attaches a clickable URL only; the PDF can be retrieved later via Zotero desktop's *Find Available PDF* action.

### Cloudflare Worker

A Worker is required for two reasons: arXiv does not return CORS headers (so PDFs cannot be fetched directly from the browser), and most WebDAV servers reject browser-issued PUT requests on the same grounds. The Worker proxies both. The Cloudflare free tier is sufficient.

Steps:

1. Create a Cloudflare account → *Workers & Pages → Create Worker*.
2. Replace the starter code with the snippet below.
3. Set `WEBDAV_HOST` to the WebDAV server's hostname.
4. Save and deploy; record the resulting `*.workers.dev` URL.

```javascript
// arxiv-pdf-proxy
//   GET  /?url=<https://arxiv.org/pdf/...>     → fetch arXiv PDF
//   GET  /?url=<https://arxiv.org/e-print/...> → fetch arXiv LaTeX source
//   PUT  /?webdav-put=<https://webdav/...>     → forward PUT to WebDAV
// All modes return CORS headers for browser invocation. Upstream Content-Type
// passes through (PDF stays application/pdf; e-print is application/gzip).

const ARXIV_HOST = 'arxiv.org';
const WEBDAV_HOST = 'mori.teracloud.jp';   // ← set to your WebDAV hostname

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    // WebDAV PUT relay
    const webdavTarget = url.searchParams.get('webdav-put');
    if (webdavTarget) {
      if (request.method !== 'PUT') {
        return cors(new Response('webdav-put requires PUT', { status: 405 }));
      }
      let target;
      try { target = new URL(webdavTarget); }
      catch { return cors(new Response('bad webdav target url', { status: 400 })); }
      if (target.protocol !== 'https:' || target.hostname !== WEBDAV_HOST) {
        return cors(new Response(`forbidden host: ${target.hostname}`, { status: 403 }));
      }
      const auth = request.headers.get('X-WebDAV-Auth');
      if (!auth) {
        return cors(new Response('missing X-WebDAV-Auth', { status: 401 }));
      }
      // Buffer the body to set Content-Length explicitly; some WebDAV
      // servers reject chunked transfer-encoding from clients.
      const bodyBytes = await request.arrayBuffer();
      const upstream = await fetch(target.toString(), {
        method: 'PUT',
        headers: {
          'Authorization': auth,
          'Content-Type': request.headers.get('Content-Type') || 'application/octet-stream',
          'Content-Length': String(bodyBytes.byteLength),
        },
        body: bodyBytes,
      });
      const text = await upstream.text();
      return cors(new Response(text || `webdav ${upstream.status}`, { status: upstream.status }));
    }

    // arXiv GET relay
    const arxivUrl = url.searchParams.get('url');
    if (arxivUrl) {
      let target;
      try { target = new URL(arxivUrl); }
      catch { return cors(new Response('bad arxiv url', { status: 400 })); }
      if (target.hostname !== ARXIV_HOST) {
        return cors(new Response('forbidden host', { status: 403 }));
      }
      const upstream = await fetch(target.toString());
      return cors(new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'Content-Type':
            upstream.headers.get('Content-Type') || 'application/octet-stream',
        },
      }));
    }

    return cors(new Response('bad request', { status: 400 }));
  },
};

function cors(response) {
  const h = new Headers(response.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'X-WebDAV-Auth, Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, headers: h });
}
```

The Worker is hostname-locked: leaked URLs cannot be used to proxy traffic to other origins, and PUT operations require auth headers supplied by the caller.

---

## Architecture

### Daily pipeline

```
arXiv API → scraper.py → filter.py (Stage 1)
                            │
                            ▼
                       DeepSeek LLM (Stage 2: scoring + topic + TLDRs)
                            │
                            ▼
                       daily_json/YYYY-MM-DD.json
                            │
                            ▼
                       html_generator.py (Jinja2)
                            │
                            ▼
                       daily_html/YYYY_MM_DD.html
                            │
                            ▼
                       GitHub Pages (cron, daily)
```

### Personal mode upload flow

```
Browser ──[user clicks Add to Zotero]──┐
                                        │
                  [1] fetch PDF via Worker (CORS bypass)
                  │
        Cloudflare Worker ──► arxiv.org
                  │
                  ▼
             PDF bytes
                  │
                  [2] compute MD5 of PDF
                  │
                  [3] create Zotero attachment (md5/mtime/filename pre-set)
                  │
                  [4] build <key>.zip + <key>.prop, MD5 the zip
                  │
                  [5] PUT both files via Worker
                  │
                  ▼
       WebDAV server (e.g. mori.teracloud.jp/dav/zotero)
                  │
                  ▼
       Zotero desktop sync → PDF locally available

       [6] (best effort) repeat steps 1–5 against
           https://arxiv.org/e-print/<id> for the
           LaTeX source archive — fresh attachment
           key, second <key>.zip + <key>.prop pair.
```

---

## Security model

- **The encrypted bundle** at `js/secrets.enc.js` is published publicly. Without the site password, neither the Zotero API key, the Worker URL, nor the WebDAV credentials can be recovered.
- **Encryption** is AES-GCM, authenticated; the key is derived from the site password via PBKDF2-SHA256 with 600 000 iterations (≈ 300 ms per attempt in modern browsers).
- **Decrypted credentials** are stored only in `sessionStorage`, scoped to the tab and discarded on browser close.
- **Salt and nonce** are deterministic — derived from `SHA-512(plaintext_inputs ‖ password)` — so the bundle is byte-stable across rebuilds when inputs are unchanged, eliminating spurious diffs.
- **The Worker** is hostname-locked to `arxiv.org` (GET) and the configured WebDAV host (PUT), bounding the impact of URL leakage.

---

## Local development

A local environment is not required for normal operation but is supported for development and offline iteration.

```bash
git clone <repository-url>
cd Robotics-paper-daily.github.io
python3 -m venv .venv
source .venv/bin/activate          # Windows: .\.venv\Scripts\activate
pip install -r requirements.txt
```

Set `DEEPSEEK_API_KEY` in the environment, then:

```bash
python src/main.py                       # process today
python src/main.py --date YYYY-MM-DD     # process a specific date
python src/main.py --backfill            # detect and fill missing dates
python src/main.py --backfill --backfill-limit 3

python src/rebuild_html.py               # re-render every HTML from existing JSON
python src/rescore_stage1.py             # re-apply Stage-1 rules to all JSON
python src/rescore_stage1.py --dry-run   # statistics only
```

To rebuild the encrypted bundle locally (PowerShell):

```powershell
$env:ZOTERO_API_KEY = "..."
$env:ZOTERO_USER_ID = "..."
$env:SITE_PASSWORD  = "..."
$env:PDF_PROXY_URL  = "https://your-worker.workers.dev"
$env:WEBDAV_URL     = "https://mori.teracloud.jp/dav/zotero"
$env:WEBDAV_USER    = "..."
$env:WEBDAV_PASS    = "..."
python build_secrets.py
```

A successful run logs the output path along with `proxy embedded` / `(none)` and `webdav embedded` / `(none)` indicators.

To preview the site locally:

```bash
python -m http.server 8000
```

---

## Tuning the filter

All Stage-1 keyword tiers, weights, the Stage-1 pass threshold, the headline / low-score boundary, and the translation threshold are centralized in [src/config.py](src/config.py). After modification:

```bash
python src/rescore_stage1.py    # re-apply rules to historical JSON
python src/rebuild_html.py      # re-render every HTML
```

`rescore_stage1.py` does not invoke the LLM; existing Stage-2 scores are preserved.

---

## File structure

```
.
├── .github/workflows/daily_arxiv.yml   # Scheduled build + deploy
├── src/
│   ├── main.py                         # Fetch + filter + render entry point
│   ├── config.py                       # Stage-1 tiers, weights, thresholds, topics
│   ├── scraper.py                      # arXiv API client
│   ├── filter.py                       # Stage-1 prefilter + Stage-2 LLM rating
│   ├── html_generator.py               # Jinja2 renderer
│   ├── search_index.py                  # Size-bounded search shard generator
│   ├── rebuild_html.py                 # Re-render every HTML from JSON
│   └── rescore_stage1.py               # Re-apply Stage-1 rules to historical JSON
├── templates/paper_template.html       # Daily-report Jinja2 template
├── daily_json/                         # YYYY-MM-DD.json (papers + scores)
├── daily_html/                         # YYYY_MM_DD.html (rendered reports)
├── build_secrets.py                    # Encrypt credentials → js/secrets.enc.js
├── js/
│   ├── crypto.js                       # PBKDF2 + AES-GCM bundle decryption
│   ├── zotero.js                       # Zotero Web API v3 client
│   ├── webdav.js                       # ZIP + .prop builder + WebDAV PUT
│   ├── like.js                         # "Add to Zotero" button wiring
│   ├── translate.js                    # hjfy.top deep-link helper
│   └── secrets.enc.js                  # Encrypted credentials (auto-generated)
├── index.html                          # Password gate (personal mode entry)
├── personal.html                       # Authenticated frame
├── guest.html                          # Public read-only frame
├── list.html                           # Historical reports index
├── search.html                         # MiniSearch full-text search
├── search_index/                       # Full manifest + monthly search shards (auto-generated)
├── search_index.json                   # Bounded legacy-client compatibility index
├── reports.json                        # Per-day report manifest (auto-generated)
├── requirements.txt
├── README.md / README_ZH.md
```

---

## Acknowledgements

- Filter pipeline derived from [Arxiv_Daily_AIGC](https://github.com/onion-liu/arxiv_daily_aigc).
- Bilingual reading via [hjfy.top](https://hjfy.top).
- WebDAV integration follows the Zotero file-storage zip layout used by the official desktop client.
