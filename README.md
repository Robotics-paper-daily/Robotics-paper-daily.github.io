# Robotics Daily Papers

![Cover](cover.png)

[中文说明](README_ZH.md) · [Live site](https://robotics-paper-daily.github.io/)

| Documentation | English | 中文 |
|---|---|---|
| Project overview and quick start | This file | [README_ZH.md](README_ZH.md) |
| PaperReader user and developer guide | [app/README.md](app/README.md) | [app/README_ZH.md](app/README_ZH.md) |
| v0.3.1 release notes | [RELEASES_NOTES.md](RELEASES_NOTES.md) | [RELEASES_NOTES_ZH.md](RELEASES_NOTES_ZH.md) |
| Security policy | [SECURITY.md](SECURITY.md) | [SECURITY_ZH.md](SECURITY_ZH.md) |
| Contribution guide | [CONTRIBUTING.md](CONTRIBUTING.md) | [CONTRIBUTING_ZH.md](CONTRIBUTING_ZH.md) |
| Maintainer release checklist | [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | [RELEASE_CHECKLIST_ZH.md](RELEASE_CHECKLIST_ZH.md) |
| Windows roadmap and acceptance record | [docs/WINDOWS_ROADMAP.md](docs/WINDOWS_ROADMAP.md) | [docs/WINDOWS_ROADMAP_ZH.md](docs/WINDOWS_ROADMAP_ZH.md) |

[Third-party notices](THIRD_PARTY_NOTICES.md) are maintained as canonical
English legal and attribution text; the product, operating, security, and
release documentation above is paired in both languages.

Robotics Daily Papers is an automated arXiv digest for robotics research. A
scheduled GitHub Actions workflow collects new submissions from `cs.RO`,
`cs.AI`, `cs.CV`, and `cs.LG`, applies a keyword prefilter followed by LLM
rating, classifies the results, and publishes a searchable static archive.

The public website is intentionally **read-only**. Browsing, search, daily
reports, and outbound paper/translation links remain available in a normal
browser, but **Add to Zotero** and **「帮我读」** are PaperReader desktop features.
The browser is not asked to handle a local OneDrive folder, local credentials,
or a local AI CLI.

## v0.3.1: PaperReader for macOS and Windows

PaperReader is the local companion app for the archive. From a paper card it can:

- save a validated arXiv PDF to a OneDrive-backed Zotero linked-attachment
  directory and create the matching Zotero item;
- deep-read the paper with a locally logged-in OpenAI Codex CLI (`codex`),
  Claude Code CLI, or TraeCode CLI;
- write a structured note to an Obsidian vault, show progress, and reopen notes
  that already exist;
- fetch the newest published reports on launch, with cache and bundled-snapshot
  fallbacks.

> **Release status:** this source tree targets v0.3.1 for macOS and Windows. It
> remains a release candidate until the matching tag, GitHub Release, three
> installers, and the merged `SHA256SUMS.txt` actually exist. Check the official
> [Releases page](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases)
> before treating it as published. The source remains open under the MIT license.

| Platform | v0.3.1 status |
|---|---|
| macOS 12+ (`arm64`, `x64`) | Release target; unsigned and unnotarized candidate |
| Windows 10 and Windows 11 (`x64`) | Release target; unsigned NSIS installer candidate with the same feature set as macOS |
| Windows `arm64` | Not built |
| Linux | Unsupported; no installer or validated end-to-end workflow |

`app/run-windows.bat` is an experimental source development launcher, not a
supported product, release, or installer — the supported entry point on Windows
is the Setup installer. See the [Windows roadmap](docs/WINDOWS_ROADMAP.md) for
the delivered engineering work and the remaining hardening backlog.

## Install PaperReader

After the official v0.3.1 Release exists, download its assets from the
[GitHub Releases page](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases).
Before that, the files below are expected release artifacts, not available
downloads:

| Machine | Installer |
|---|---|
| Apple Silicon Mac (M1/M2/M3/M4 and newer) | `PaperReader-0.3.1-arm64.dmg` |
| Intel Mac | `PaperReader-0.3.1-x64.dmg` |
| Windows 10/11 PC (`x64`) | `PaperReader-0.3.1-x64-Setup.exe` |

Download `SHA256SUMS.txt` from the same release and verify before opening. On
macOS:

```bash
cd ~/Downloads
# Apple Silicon:
grep 'PaperReader-0.3.1-arm64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
# Intel:
grep 'PaperReader-0.3.1-x64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
```

On Windows, in PowerShell:

```powershell
cd "$env:USERPROFILE\Downloads"
Get-FileHash .\PaperReader-0.3.1-x64-Setup.exe -Algorithm SHA256
# Compare the printed hash with the Setup.exe line in SHA256SUMS.txt.
```

or in Git Bash:

```bash
grep 'PaperReader-0.3.1-x64-Setup.exe$' SHA256SUMS.txt | sha256sum -c -
```

Run the line for the downloaded file; it must report `OK` (or a hash that
matches the manifest exactly). Do not install an artifact whose checksum does
not match. Do not use the retired v0.2 browser writer as a substitute for the
v0.3.1 candidate.

### Requirements

- macOS 12 or newer, or Windows 10/11 on `x64`;
- the installer matching the machine: the `arm64` DMG for Apple Silicon (M1 and
  newer), the `x64` DMG for Intel Macs, or the `x64` Setup exe for Windows;
- Zotero desktop, installed and running;
- OneDrive desktop, signed in and syncing locally (on Windows, keep OneDrive
  Files On-Demand enabled — the current OneDrive default);
- an Obsidian vault;
- at least one locally installed and authenticated reading provider:
  - [OpenAI Codex CLI (`codex`)](https://developers.openai.com/codex/cli/):
    install the public CLI and sign in through it with ChatGPT or a supported
    API authentication method; or
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started): install
    the public CLI and complete its subscription/OAuth login; or
  - TraeCode CLI (`trae-cli` / `trae-agent`): only for users who have already
    been given a supported CLI build and account. This project does not publish
    or provision TraeCode CLI.
- Python 3 with PyMuPDF for paper extraction. Prefer an isolated environment
  and install the pinned range from `skills/paper-reading/requirements.txt`.
  On macOS:

  ```bash
  python3 -m venv "$HOME/.paperreader-python"
  "$HOME/.paperreader-python/bin/python3" -m pip install 'PyMuPDF>=1.24,<2'
  "$HOME/.paperreader-python/bin/python3" -c 'import fitz; print(fitz.VersionBind)'
  ```

  Add `$HOME/.paperreader-python/bin` to the login-shell `PATH` so a Finder-launched
  App resolves that `python3` first, then restart PaperReader. On Windows,
  install Python 3 from [python.org](https://www.python.org/downloads/) (it
  includes the `py` launcher), then for example:

  ```bat
  py -3 -m venv %USERPROFILE%\.paperreader-python
  %USERPROFILE%\.paperreader-python\Scripts\python.exe -m pip install "PyMuPDF>=1.24,<2"
  ```

  and select that `python.exe` in PaperReader Settings (**Python 3 解释器 /
  Python 3 interpreter**), or ensure `py -3 -c "import fitz"` works. Detection
  tries `py -3`, then `python`, then `python3`, and rejects the Microsoft Store
  python stub automatically. Source builders can instead install from
  [`skills/paper-reading/requirements.txt`](skills/paper-reading/requirements.txt).

The v0.3.1 installers are unsigned: the DMGs have no Apple Developer ID
signature and are not notarized, and the Windows setup carries no Authenticode
signature. On macOS first launch, open Applications in Finder, Control-click or
right-click PaperReader, choose **Open**, then confirm **Open**. On Windows
first run, Microsoft Defender SmartScreen may warn; after verifying the
SHA-256, choose **More info** → **Run anyway** for this one file. Do not
disable Gatekeeper, SmartScreen, or other OS security globally.

### Manual upgrades without reconfiguration

Quit PaperReader, download and verify the newer installer, then replace the old
build: on macOS, drag the new App to Applications and replace the existing
copy; on Windows, run the newer Setup exe over the existing installation.
Settings, report cache, and encrypted Zotero credentials remain under
`~/Library/Application Support/PaperReader/` on macOS and
`%APPDATA%\PaperReader\` on Windows.
Moving the OneDrive linked-attachment directory or switching Zotero profiles
requires confirming the directory again in Settings.

### First-time setup

1. Sign in to Zotero desktop with the **same personal-library account** that
   owns the API key, enable Zotero Sync, and run one successful desktop sync.
   Start OneDrive and wait until the intended directory is available locally.
2. In Zotero, open **Settings → Advanced → Files and Folders** and set
   **Linked Attachment Base Directory** to a folder inside OneDrive, for example
   `OneDrive/Zotero-Attachments`.
3. On [Zotero's official key page](https://www.zotero.org/settings/keys/new),
   create a private **24-character API key** for your
   personal library. Enable library access and write access. Do not commit or
   share this key.
4. Open PaperReader → **Settings**, paste the key, and choose **Verify and
   securely save** (or **Save all settings**). PaperReader verifies it with Zotero and derives the numeric user ID
   automatically; users do not need to find or type the ID.
5. PaperReader detects Zotero's active profile and linked-attachment directory.
   If directory selection is requested, choose the exact same OneDrive folder
   configured in Zotero. A real-path mismatch is rejected.
6. Select the Obsidian vault that will receive notes. The `paper-reading` skill
   ships with PaperReader; a fresh vault does not need a copied skill. Choose a
   dedicated folder: PaperReader rejects the filesystem root, the user home or
   any ancestor of it, and broad top-level home folders such as `Documents`,
   `Downloads`, `Library`, `.config`, `.local`, `.codex`, and `.ssh`. A dedicated
   nested folder such as `~/Documents/PaperReadingDaily` is valid. Codex jobs
   also reject a vault that overlaps PaperReader's user-data/cache directory,
   `$CODEX_HOME`, or the user's SSH directory.
7. Select Codex, Claude, or Trae and confirm the detected CLI path. Sign in with
   the provider's own CLI before starting a read. Codex uses the login already
   held by the local `codex` CLI; PaperReader never asks for, collects, or saves
   the ChatGPT login or OpenAI API key. In Terminal, confirm that the login
   shell can run `python3 -c 'import fitz'` before the first job.
8. For cross-device notes, choose exactly one setup: put the **whole Obsidian
   vault** in OneDrive and open that synced folder on every device, *or* keep it
   outside OneDrive and use Obsidian Sync. Never run both synchronizers on the
   same vault. Keep Zotero's linked-PDF directory separate from the vault.

On a fresh configuration, provider discovery prefers Codex, then Claude, then
Trae; if none is detected, onboarding remains on Codex. A provider already
chosen explicitly is never replaced. An empty `codexModel` uses Codex's default
for the isolated job; PaperReader does not load the user's `config.toml`.
Filling it applies an explicit model to PaperReader jobs.

The API key and derived user ID are encrypted with Electron `safeStorage` — the
Keychain-backed storage path on macOS, the Windows DPAPI-backed path on
Windows — in `zotero-credentials.secure.json` inside the App's user-data
directory (`~/Library/Application Support/PaperReader/` on macOS,
`%APPDATA%\PaperReader\` on Windows).
Non-secret settings are in `config.json` beside it. The key is never included
in the website, repository, report iframe, settings JSON, logs, or generated
notes. Anyone who used the retired v0.2 browser writer must revoke and rotate
every old Zotero key and WebDAV password; deleting old files cannot revoke a
credential that appeared in earlier history.

After the key is saved, PaperReader performs a read-only, paginated scan of the
personal library. It recognizes arXiv IDs across bibliographic item types and
collections, so reinstalling the app restores **In Zotero** state for existing
papers instead of treating only the `Daily Paper` collection as known. Items
outside PaperReader's collection remain presence-only: the app will not
duplicate, move, attach to, or delete them. Parents newly created by v0.3.0 and
later have the visible
tag `paperreader-managed-v1`; repair/Remove requires both that tag and current
membership in the `Daily Paper` tree. Untagged legacy/manual entries are
presence-only even if they are inside that tree.

### Add to Zotero

Zotero and OneDrive have distinct jobs: Zotero Web API creates the item,
collections, and linked-attachment metadata; OneDrive synchronizes only the PDF
bytes. The Zotero desktop client then downloads metadata through normal Zotero
Sync and resolves the linked path against its local base directory.

Click **Add to Zotero** once; there is no second PaperReader confirmation dialog.
The app then:

1. re-reads Zotero's active profile and verifies that PaperReader and Zotero
   resolve to the same OneDrive linked-attachment base directory;
2. downloads the canonical arXiv PDF, validates its content, and writes it
   without overwriting a conflicting file;
3. waits for the platform cloud check — macOS File Provider, or on Windows the
   NTFS cloud-files placeholder attributes maintained by the OneDrive sync
   engine — to confirm that OneDrive has uploaded the file without a conflict,
   then hashes the committed file again; and
4. creates the Zotero parent item and a `linked_file` child whose path is a flat
   `attachments:<filename>.pdf` reference.

The PDF download, local commit, OneDrive confirmation, and final re-hash stage
uses a fixed four-slot queue. A burst of more than ten papers is accepted: four
run at once and the rest wait in FIFO order. Requests with the same operation
key are coalesced while queued or running, and a success or failure always frees
the slot. This queue is separate from configurable AI reading concurrency.

Cards and search results are filed under `Daily Paper/<report date>`. A manually
entered arXiv link is filed under `Daily Paper/<arXiv first-published date>`.
This date choice is deterministic and may differ from the day you clicked Add.

If the folder, PDF, cloud state, or Zotero API request cannot be verified, the
operation stops with an actionable error. A failure after OneDrive commit may
leave a verified PDF in the linked directory; this is intentional and a safe
retry reuses/reconciles it instead of uploading another copy. Zotero metadata
can appear later than the OneDrive file. Wait for the App's final success, then
run Zotero desktop Sync. **Remove** deletes only the PaperReader-managed Zotero
item; it does not delete the OneDrive PDF.

### Read into Obsidian

Click **「帮我读」** to run the selected local provider. OpenAI Codex CLI
(`codex`) uses its existing ChatGPT/API login, Claude uses an authenticated
`claude` CLI and its subscription/OAuth session, and Trae uses a locally
authenticated `trae-cli` or `trae-agent`. PaperReader does not collect or save
AI-provider credentials. Progress appears in the app, and the result is written
under:

```text
<vault>/<date>/<title>/
```

If a matching note already exists, the card shows **笔记** and opens it instead
of starting another read. It shows **✓ 已读** only after the note's final
`- [ ] ✅ 已读` checkbox is checked in Obsidian (`- [x]`). Temporary inputs live
in an App-owned directory outside the vault (`$PAPERREADER_CACHE_DIR`), so they
are not synced as notes.

The selected provider is a separate cloud service: the CLI may send the paper,
prompt, and generated context to that provider. PaperReader passes the exact
resolved path of its bundled `paper-reading/SKILL.md` to the CLI. The Codex
adapter runs non-interactively with `codex exec --json --ephemeral` and a named
permission profile based on Codex's `:workspace` boundary. Filesystem reads are
denied by default; only Codex's minimal runtime, the bundled skill, the probed
Python/PyMuPDF runtime, selected vault content outside `.obsidian`, and the App
cache are exposed. The same vault content and cache are writable; system
temporary directories are denied and
redirected into the App cache, network access is enabled, and interactive
approvals are disabled. Before declaring Codex ready, the environment check
forces the CLI to parse every security-sensitive override locally by supplying
a randomly named, deliberately missing output-schema path; it accepts only the
exact missing-file failure, creates no schema file, and never calls a model.
The adapter ignores the user's general Codex config/rules,
marks the vault untrusted so project `.codex` config/hooks/rules are skipped,
and disables global/vault `AGENTS.md` discovery, plugins, apps, hooks, skill
discovery, login shells, and shell snapshots; it passes only a core shell
environment plus the exact App cache and
Python paths. Sandboxed commands cannot read `$CODEX_HOME`, SSH material,
PaperReader settings, the vault's `.obsidian` configuration/plugins, or
unrelated home-directory files. Codex itself can still
authenticate through `codex login`. Permission profiles are a beta defense in
depth, not an OS security boundary. Claude and Trae use their provider-specific
non-interactive bypass modes. Use only a trusted vault and review the provider's
terms.
Paper/PDF/HTML/repository content is untrusted input. The bundled skill rejects
embedded instructions and forbids credential or unrelated local-file reads; stop
a task if its generated command or output is unrelated to paper analysis.
PaperReader itself has no built-in analytics or telemetry; normal network calls
still go to the public report site, arXiv, Zotero, OneDrive/File Provider, and
the chosen AI provider as required by the feature.

### Sync troubleshooting

- **PDF is in OneDrive but the item is absent:** wait for the Add operation to
  finish, then confirm the API key belongs to the same Zotero account as the
  desktop client and click Zotero's Sync button. Check
  `Daily Paper/<expected date>` and search the whole library by arXiv ID.
- **Item is visible on zotero.org but not desktop:** Zotero metadata sync has not
  completed; this is independent of OneDrive file sync.
- **Item is visible but the PDF cannot open on another Mac:** configure that
  Mac's Linked Attachment Base Directory to its own local copy of the same
  OneDrive folder and wait for the file to download locally.
- **Add failed after writing a PDF:** leave the verified file in place and retry
  the same paper. Do not rename or duplicate it between attempts.
- **Notes conflict across devices:** stop one of the two vault synchronizers,
  keep a single canonical vault, let it finish, and then reopen that vault in
  Obsidian on each device.
- **Reading fails before extraction:** run `python3 -c 'import fitz'` in a login
  shell (on Windows, `py -3 -c "import fitz"` or the interpreter selected in
  Settings) and verify the selected AI CLI is installed and logged in.

See the [full App guide](app/README.md) for error-specific checks.

## Website features

The GitHub Pages site provides:

1. daily ingestion with bounded arXiv client retries plus 30/60-second outer
   delays, while DeepSeek calls use bounded exponential backoff;
2. a four-tier keyword prefilter followed by DeepSeek scoring;
3. topic labels, keyword tags, and bilingual TLDRs;
4. date-keyed JSON and rendered HTML archives;
5. a size-bounded, monthly sharded full-text search index;
6. missing-day backfill plus automatic repair of reports whose entire AI rating
   stage failed; and
7. historical Stage-1 rescoring without another LLM call.

The site does **not** store Zotero credentials, write PDFs, start local CLIs, or
modify an Obsidian vault. Those controls are shown only in PaperReader. This
separation is deliberate: browser sandboxing cannot provide the filesystem and
cloud-confirmation guarantees required by the linked-file workflow.

## Deploy your own read-only site

1. Fork this repository.
2. In **Settings → Pages**, deploy `main` from `/`.
3. Add a provider-issued `DEEPSEEK_API_KEY` under **Settings → Secrets and
   variables → Actions**.
4. Add repository variables `DEEPSEEK_API_BASE` and `DEEPSEEK_MODEL` for the
   same provider. For the official service, use `https://api.deepseek.com` and
   `deepseek-v4-flash`. If omitted, forks default to that official pair; only
   the canonical `Robotics-paper-daily` repository keeps its legacy
   SJTU-compatible gateway and `deepseek-chat` contract.
5. Run **Daily arXiv Paper Fetch and Filter** once from the Actions tab.

The endpoint operator receives both the API key and paper prompts. Never reuse
one provider's key at another endpoint. The pipeline does not fall back between
providers: authentication/configuration failures stop publication instead of
creating a report with zero AI ratings.

The generated site will appear at
`https://<username>.github.io/<repository>/`. No Zotero key, site password,
OneDrive credential, WebDAV server, or Cloudflare Worker is required for the
website.

## Architecture

### Daily publishing pipeline

```text
arXiv API
  → scraper.py
  → filter.py (keyword Stage 1 → DeepSeek Stage 2)
  → daily_json/YYYY-MM-DD.json
  → html_generator.py
  → daily_html/YYYY_MM_DD.html
  → GitHub Pages
```

### PaperReader local flow

```text
read-only published report
  → sandboxed report view + bundled app bridge
  ├─ Add to Zotero
  │    → verified OneDrive folder → validated PDF → cloud confirmation
  │    → Zotero Web API parent + linked_file metadata
  └─ 「帮我读」
       → local Codex/Claude/Trae CLI → bundled paper-reading skill
       → structured Obsidian note + progress events
```

Remote report HTML is treated as untrusted content. It runs in a unique-origin
sandbox under a restrictive content policy; credentials remain in the trusted
app layer. Privileged requests pass through a narrow allowlist with scoped,
recent user-gesture checks. The report cannot request arbitrary filesystem or
network access.

## Local development

### Daily pipeline and site

Use Python 3.10 or newer. CI is fixed to Python 3.14; the pinned `arxiv` and
`requests` versions do not support Python 3.9.

```bash
git clone <repository-url>
cd Robotics-paper-daily.github.io
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt

export DEEPSEEK_API_KEY="..."
# Optional. Local runs default to the official DeepSeek endpoint/model.
export DEEPSEEK_API_BASE="https://api.deepseek.com"
export DEEPSEEK_MODEL="deepseek-v4-flash"
python3 src/main.py
python3 src/main.py --date YYYY-MM-DD
python3 src/main.py --backfill --backfill-limit 3
python3 src/rescore_stage1.py --dry-run
python3 src/rebuild_html.py
```

Preview the static output with `python3 -m http.server 8000`.

### PaperReader

```bash
cd app
npm ci
npm test
npm start
```

PaperReader v0.3.1 uses Electron 43 and electron-builder 26. The locked install
is reproducible from `app/package-lock.json`.

To build both Mac architectures locally on macOS:

```bash
cd app
npm run dist:mac
```

To build the Windows installer locally on Windows x64:

```bash
cd app
npm run dist:win
```

Pushing a semantic-version tag matching `v*` runs the CI workflow on macOS and
Windows runners: it installs locked dependencies, runs the complete app test
suite on both platforms, builds the unsigned Apple Silicon and Intel DMGs and
the unsigned Windows NSIS installer, audits the packaged apps, and publishes
the three installers plus one merged `SHA256SUMS.txt` to a GitHub Release. Only
after the published assets are verified may documentation mark it stable.
Maintainers must complete [the release checklist](RELEASE_CHECKLIST.md) before
tagging.

## Tuning the filter

Stage-1 keyword tiers, weights, thresholds, and topics live in
[`src/config.py`](src/config.py). After a policy change:

```bash
python3 src/rescore_stage1.py
python3 src/rebuild_html.py
```

Historical Stage-2 results remain intact; rescoring does not call the LLM.

## Repository map

```text
.
├── .github/workflows/
│   ├── daily_arxiv.yml          # fetch, filter, render, publish
│   └── build-app.yml            # tests + Mac DMG and Windows installer release target
├── app/                         # PaperReader Electron application
├── docs/                        # platform plans and engineering records
├── skills/paper-reading/        # skill bundled into PaperReader
├── src/                         # ingestion, filtering, rendering, search
├── templates/                   # daily report templates
├── daily_json/                  # structured daily archive
├── daily_html/                  # rendered daily reports
├── search_index/                # monthly search shards
└── reports.json                 # report manifest
```

## License and acknowledgements

The project is released under the [MIT License](LICENSE). The filter pipeline
was derived from [Arxiv_Daily_AIGC](https://github.com/onion-liu/arxiv_daily_aigc).
Bilingual reading links use [hjfy.top](https://hjfy.top). See
[third-party notices](THIRD_PARTY_NOTICES.md) for bundled dependencies and
external-service boundaries.

Development setup, generated-file policy, required checks, and pull request
expectations are documented in [CONTRIBUTING.md](CONTRIBUTING.md). Report
possible vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.
