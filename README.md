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

[Third-party notices](THIRD_PARTY_NOTICES.md) are maintained in English.

Robotics Daily Papers is an automated arXiv digest for robotics research. A
scheduled GitHub Actions workflow collects new submissions from `cs.RO`,
`cs.AI`, `cs.CV`, and `cs.LG`, applies a keyword prefilter followed by LLM
rating, classifies the results, and publishes a searchable static archive.

The public website is **read-only**. Browsing, search, daily
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

PaperReader v0.3.1 is available on [GitHub Releases](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1).

| Platform | v0.3.1 status |
|---|---|
| macOS 12+ (`arm64`, `x64`) | DMGs available; unsigned and unnotarized |
| Windows 10 and Windows 11 (`x64`) | NSIS installer available; unsigned |
| Windows `arm64` | Not built |
| Linux | Unsupported; no installer or validated end-to-end workflow |

Windows includes Zotero saving, AI reading, and Obsidian notes. Some real-device
checks, including OneDrive sync states, remain pending; see the
[Windows roadmap and acceptance record](docs/WINDOWS_ROADMAP.md).

## Install PaperReader

Download the installer for your machine from the
[v0.3.1 release](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1):

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
matches the manifest exactly). Do not install a file whose checksum does not
match. A matching checksum checks file integrity, not publisher identity.

On macOS, open the DMG and drag PaperReader to Applications. On Windows, run the
Setup exe and follow the installer.

The installers are unsigned, and the macOS apps are not notarized. If macOS
blocks the first launch as an unidentified developer or unnotarized app, first
verify that the download is trusted, then follow
[Apple's instructions](https://support.apple.com/en-us/102445): after attempting
to open it, go to **System Settings → Privacy & Security → Open Anyway** and
confirm **Open**. Do not use this exception for malware or damaged-app warnings.
If Windows SmartScreen warns about an unrecognized app, check the source and
checksum before choosing **More info → Run anyway** for this installer.
Do not disable the operating system's security protections globally.

### Requirements

Browsing reports requires only PaperReader on a supported platform and an
internet connection to fetch new reports. The following dependencies are needed
for the corresponding local features:

- **Save to Zotero:** Zotero desktop, installed and running, plus OneDrive
  desktop signed in and syncing locally. On Windows, keep Files On-Demand enabled.
- **Read into Obsidian:** an Obsidian vault, Python 3 with PyMuPDF, and at least
  one installed and authenticated reading provider:
  - [OpenAI Codex CLI (`codex`)](https://developers.openai.com/codex/cli/):
    install the public CLI and sign in through it with ChatGPT or a supported
    API authentication method; or
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started): install
    the public CLI and complete its subscription/OAuth login; or
  - TraeCode CLI (`trae-cli` / `trae-agent`): only for users who have already
    been given a supported CLI build and account. This project does not publish
    or provision TraeCode CLI.

For PDF extraction, install PyMuPDF in an isolated Python environment. On macOS:

```bash
python3 -m venv "$HOME/.paperreader-python"
"$HOME/.paperreader-python/bin/python3" -m pip install 'PyMuPDF>=1.24,<2'
"$HOME/.paperreader-python/bin/python3" -c 'import fitz; print(fitz.VersionBind)'
```

Add `$HOME/.paperreader-python/bin` to the login-shell `PATH` so a Finder-launched
App resolves that `python3` first, then restart PaperReader. On Windows,
install Python 3 from [python.org](https://www.python.org/downloads/) with the
`py` launcher, then run these commands in PowerShell:

```powershell
py -3 -m venv "$env:USERPROFILE\.paperreader-python"
& "$env:USERPROFILE\.paperreader-python\Scripts\python.exe" -m pip install "PyMuPDF>=1.24,<2"
```

Select that `python.exe` in PaperReader Settings (**Python 3 解释器** / Python 3
interpreter), or ensure `py -3 -c "import fitz"` works. Detection tries `py -3`,
then `python`, then `python3`, and rejects the Microsoft Store Python stub.
Source builders can install from
[`skills/paper-reading/requirements.txt`](skills/paper-reading/requirements.txt).

### Manual upgrades without reconfiguration

Quit PaperReader, download and verify the newer installer, then replace the old
build: on macOS, drag the new App to Applications and replace the existing
copy; on Windows, run the newer Setup exe over the existing installation.
Settings, report cache, and encrypted Zotero credentials remain under
`~/Library/Application Support/PaperReader/` on macOS and
`%APPDATA%\PaperReader\` on Windows.
Moving the OneDrive linked-attachment directory or switching Zotero profiles
requires confirming the directory again in Settings.

If you used the retired v0.2 browser writer, revoke and replace its Zotero API
keys and WebDAV passwords. Deleting old files does not revoke exposed credentials.

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
4. Open PaperReader → **设置** (Settings), paste the key, and choose
   **验证并安全保存** (Verify and securely save), or **保存全部设置** (Save all settings).
   PaperReader verifies the key with Zotero and fills in the user ID.
5. PaperReader detects Zotero's active profile and linked-attachment directory.
   If directory selection is requested, choose the exact same OneDrive folder
   configured in Zotero. A real-path mismatch is rejected.
6. For AI reading, select a dedicated Obsidian vault such as
   `~/Documents/PaperReadingDaily`, not your home directory or the whole
   `Documents` folder. The `paper-reading` skill ships with PaperReader; it does
   not need to be copied into the vault. See [Security](SECURITY.md) for directory restrictions.
7. Select Codex, Claude, or Trae and confirm the detected CLI path. Sign in with
   the provider's own CLI before starting a read. Codex uses the login already
   held by the local `codex` CLI; PaperReader never asks for, collects, or saves
   the ChatGPT login or OpenAI API key. Confirm that the Python environment
   configured above can import `fitz` before the first job.
8. For cross-device notes, choose exactly one setup: put the **whole Obsidian
   vault** in OneDrive and open that synced folder on every device, *or* keep it
   outside OneDrive and use Obsidian Sync. Never run both synchronizers on the
   same vault. Keep Zotero's linked-PDF directory separate from the vault.

Steps 1–5 configure Zotero saving; steps 6–8 configure reading and note syncing.

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
Non-secret settings are in `config.json` beside it. PaperReader does not include
the key in the website, report view, settings JSON, logs, or generated notes.

After the key is saved, PaperReader performs a read-only, paginated scan of the
personal library. It recognizes arXiv IDs across bibliographic item types and
collections, so reinstalling the app restores **In Zotero** state for existing
papers instead of treating only the `Daily Paper` collection as known. Items
outside PaperReader's collection remain presence-only: the app will not
duplicate, move, attach to, or delete them. Parents newly created by v0.3.0 and
later have the tag `paperreader-managed-v1`; repair/Remove requires both that tag and current
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
3. checks the local OneDrive sync state, then hashes the saved file again; and
4. creates the Zotero parent item and a `linked_file` child whose path is a flat
   `attachments:<filename>.pdf` reference.

The Zotero PDF download, local save, OneDrive check, and final hash check use a
fixed queue of four concurrent tasks. Additional papers wait in submission
order; duplicate requests for the same save operation are merged while pending.
This limit is separate from AI reading concurrency and does not apply to every
Zotero API request. Queuing does not prevent network or API failures.

On macOS, the sync check reads File Provider's upload and conflict status. On
Windows, it checks the local file's reparse-point attribute; this does not prove
that uploading has finished or that the cloud copy is conflict-free. Neither
platform downloads the cloud copy for a byte-for-byte comparison. Check OneDrive
sync completion before opening the PDF on another device.

Cards and search results are filed under `Daily Paper/<report date>`. A manually
entered arXiv link is filed under `Daily Paper/<arXiv first-published date>`.
The collection date may therefore differ from the day you clicked Add.

If a directory, PDF, sync-state check, or Zotero API request fails, the app
reports an error. A failure after saving the PDF may leave the validated file
in the linked directory; retrying the same paper can reuse it. Zotero metadata
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

The CLI may send paper content, prompts, and context to the selected AI service.
Reading tasks can read and write the selected vault and use the network without
asking for approval at each step. Codex has a restricted permission profile;
Claude and Trae use their own permission-bypass modes and do not share that
profile. Use a dedicated vault without sensitive files. Paper content can contain
malicious instructions, and the reading prompt alone cannot prevent those from
affecting a task. See [Security](SECURITY.md) for provider permissions and data handling.

PaperReader has no built-in analytics or telemetry. It contacts the report site,
arXiv, Zotero, OneDrive, and the selected AI service as needed.

### Sync troubleshooting

- **PDF is in OneDrive but the item is absent:** wait for the Add operation to
  finish, then confirm the API key belongs to the same Zotero account as the
  desktop client and click Zotero's Sync button. Check
  `Daily Paper/<expected date>` and search the whole library by arXiv ID.
- **Item is visible on zotero.org but not desktop:** Zotero metadata sync has not
  completed; this is independent of OneDrive file sync.
- **Item is visible but the PDF cannot open on another device:** configure that
  device's Linked Attachment Base Directory to its own local copy of the same
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
modify an Obsidian vault. Those controls are shown only in PaperReader, which
can access the local linked-attachment directory and OneDrive sync status.

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
  │    → verified OneDrive folder → validated PDF → local sync-state check
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

`app/run-windows.bat` is a source development helper, not a product installer.
Use the Setup installer for normal Windows use.

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
the three installers plus one merged `SHA256SUMS.txt` to a GitHub Release.
The full release procedure is in [the release checklist](RELEASE_CHECKLIST.md).

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
│   └── build-app.yml            # tests, Mac DMGs, Windows installer, GitHub Release
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
