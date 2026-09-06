# PaperReader v0.3.1

[中文版本](README_ZH.md)

PaperReader is the desktop companion to Robotics Daily Papers. The public site
is read-only; all operations that need local files or local credentials live in
this Electron app.

This source tree targets v0.3.1 for macOS and Windows in three builds:

- `PaperReader-0.3.1-arm64.dmg` — Apple Silicon (M1 and newer)
- `PaperReader-0.3.1-x64.dmg` — Intel Mac
- `PaperReader-0.3.1-x64-Setup.exe` — Windows 10/11 (`x64`), NSIS per-user installer

It remains a release candidate until the matching tag, GitHub Release, all
three installers, and the merged `SHA256SUMS.txt` actually exist. Check the
official
[Releases page](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases)
before treating it as published.

| Platform | Status |
|---|---|
| macOS 12+ (`arm64`, `x64`) | v0.3.1 release target; unsigned and unnotarized candidate |
| Windows 10 and Windows 11 (`x64`) | v0.3.1 release target; unsigned NSIS installer candidate, feature-identical to macOS |
| Windows `arm64` | Not built |
| Linux | Unsupported; no installer or validated workflow |

`run-windows.bat` is an experimental source development launcher, not a
supported product, release, or installer — the supported Windows entry point is
the Setup installer. The delivered platform adapters, packaging, and CI, plus
the remaining acceptance and hardening work, are tracked in the
[Windows roadmap](../docs/WINDOWS_ROADMAP.md).

## What the app does

- **Add to Zotero:** places a validated arXiv PDF in Zotero's OneDrive-backed
  Linked Attachment Base Directory and creates a matching `linked_file` item.
- **「帮我读」:** starts a locally authenticated OpenAI Codex CLI (`codex`),
  Claude Code CLI, or TraeCode CLI with the bundled `paper-reading` skill and
  writes a structured Obsidian note.
- **Already-read state:** detects notes in the selected vault and opens them
  directly.
- **Latest reports:** fetches the current published report manifest and pages,
  then falls back to an offline cache or bundled snapshot when needed.

The Add to Zotero and reading controls are injected by PaperReader. They are not
maintained as browser features and are not shown on the public website.

## Requirements

- macOS 12 or newer, or Windows 10/11 on `x64`;
- Zotero desktop, installed and running;
- OneDrive desktop, signed in and syncing locally (on Windows, keep OneDrive
  Files On-Demand enabled — the current OneDrive default);
- a dedicated Obsidian vault containing `.obsidian/`; PaperReader rejects the
  filesystem root, the user home or any ancestor of it, and broad top-level
  home folders such as `Documents`, `Downloads`, `Library`, `.config`, `.local`,
  `.codex`, and `.ssh`. A dedicated nested folder is valid. Codex also rejects
  vaults overlapping PaperReader user data/cache, `$CODEX_HOME`, or SSH;
- one installed and logged-in provider:
  - [OpenAI Codex CLI (`codex`)](https://developers.openai.com/codex/cli/):
    install the public CLI and use its own ChatGPT or supported API login; or
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started):
    public `claude` CLI with its subscription/OAuth login; or
  - TraeCode CLI: `trae-cli` or `trae-agent`, only if a supported CLI build and
    account have already been provided to you. PaperReader does not distribute
    or provision TraeCode CLI.
- Python 3 with PyMuPDF (`fitz`). On macOS it must be a `python3` on the
  login-shell `PATH` used by a Finder-launched App. One isolated setup is:

  ```bash
  python3 -m venv "$HOME/.paperreader-python"
  "$HOME/.paperreader-python/bin/python3" -m pip install 'PyMuPDF>=1.24,<2'
  "$HOME/.paperreader-python/bin/python3" -c 'import fitz; print(fitz.VersionBind)'
  ```

  Add `$HOME/.paperreader-python/bin` to the login-shell `PATH`, restart the App,
  and verify `python3 -c 'import fitz'` in a login shell. On Windows, install
  Python 3 from [python.org](https://www.python.org/downloads/) (it includes
  the `py` launcher), then for example:

  ```bat
  py -3 -m venv %USERPROFILE%\.paperreader-python
  %USERPROFILE%\.paperreader-python\Scripts\python.exe -m pip install "PyMuPDF>=1.24,<2"
  ```

  and select that `python.exe` in Settings (**Python 3 解释器 / Python 3
  interpreter**), or ensure `py -3 -c "import fitz"` works. Windows detection
  tries `py -3`, then `python`, then `python3`, persists the exact resolved
  `python.exe`, and rejects the Microsoft Store python stub automatically.
  Source builders can use
  [`../skills/paper-reading/requirements.txt`](../skills/paper-reading/requirements.txt).

PaperReader does not collect or save any AI-provider credential. Codex uses the
ChatGPT/API authentication already managed by the local `codex` CLI; sandboxed
job commands are explicitly denied access to `$CODEX_HOME`. Claude and Trae
likewise use their own local CLI sessions. Usage, model availability, and quotas
follow those accounts.

## Download, verify, and install

1. After v0.3.1 actually appears on the official
   [Releases page](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases),
   download the installer matching the machine plus `SHA256SUMS.txt`.
2. Verify the downloaded file first. On macOS, in Terminal after `cd ~/Downloads`:
   - Apple Silicon: `grep 'PaperReader-0.3.1-arm64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -`
   - Intel: `grep 'PaperReader-0.3.1-x64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -`
   On Windows, in PowerShell:
   `Get-FileHash .\PaperReader-0.3.1-x64-Setup.exe -Algorithm SHA256`, and
   compare the printed hash with the Setup.exe line in `SHA256SUMS.txt`; or in
   Git Bash:
   `grep 'PaperReader-0.3.1-x64-Setup.exe$' SHA256SUMS.txt | sha256sum -c -`.
   The check must pass before installing.
3. macOS: open the DMG and drag PaperReader to Applications. Windows: run the
   Setup exe — a per-user NSIS installer that lets you choose the install
   directory.
4. macOS first launch: in Finder, open Applications, Control-click or
   right-click PaperReader, choose **Open**, then confirm **Open**. Windows
   first run: if Microsoft Defender SmartScreen warns, choose **More info** →
   **Run anyway** for this one verified file.

The installers are unsigned: the DMGs have no Apple Developer ID signature and
are not notarized, and the Windows setup has no Authenticode signature. The
per-file approvals above (Finder's right-click **Open**, SmartScreen's **Run
anyway**) cover this App without disabling Gatekeeper, SmartScreen, or other OS
security globally — never do that.

### Manual upgrades without resetting settings

Quit PaperReader, download and verify the newer installer, then replace the old
build: on macOS drag the new App to Applications and replace the existing copy;
on Windows run the newer Setup exe over the existing installation. The new
version reuses settings, report cache, and encrypted Zotero credentials under
`~/Library/Application Support/PaperReader/` on macOS or
`%APPDATA%\PaperReader\` on Windows.
Moving the OneDrive linked-attachment directory or switching Zotero profiles
requires confirming the directory again in Settings. Uninstalling on Windows
keeps the per-user data in `%APPDATA%\PaperReader`; delete that folder manually
for a full cleanup.

## First-run setup

### 1. Prepare Zotero and OneDrive

1. Sign in to Zotero desktop with the **same personal-library account** that
   will own the API key. Enable Zotero Sync and complete one manual sync.
2. Start OneDrive and wait for sync to become available.
3. Start Zotero.
4. In Zotero, open **Settings → Advanced → Files and Folders**.
5. Set **Linked Attachment Base Directory** to a folder inside OneDrive, such as
   `OneDrive/Zotero-Attachments`.

Use a dedicated, flat attachment directory. PaperReader refuses a location
outside the platform's OneDrive scope — the current OneDrive File Provider
container on macOS; on Windows, the signed-in account's OneDrive sync folder,
discovered from the per-user `OneDrive` / `OneDriveConsumer` /
`OneDriveCommercial` environment variables and compared as resolved real paths
case-insensitively — and refuses a path that resolves differently from
Zotero's active profile.

### 2. Create and save a Zotero key

1. Open [Zotero's key creation page](https://www.zotero.org/settings/keys/new).
2. Create a private 24-character key for the personal library.
3. Enable personal-library read access and write access.
4. In PaperReader → **Settings**, paste the key and choose **Verify and securely
   save** (or **Save all settings**).

PaperReader calls Zotero's current-key endpoint, verifies the required
permissions, and derives the numeric user ID automatically. Only the API key is
entered by the user.

The key and user ID are encrypted through Electron `safeStorage`; macOS uses
the Keychain-backed system facility, and Windows uses the DPAPI-backed one. The
encrypted envelope is stored with private
file permissions in the app's user-data directory. There is no plaintext
fallback: if system encryption is unavailable, PaperReader refuses to save the
credential. The settings screen never displays a stored key again.

If v0.2's retired browser writer ever held a Zotero key or WebDAV password,
revoke and rotate those credentials before configuring v0.3.1. Removing an old
bundle from the current checkout cannot revoke a secret present in Git history.

Saving the key also causes the shell to build a read-only, fully paginated
presence index of the personal library. PaperReader extracts explicit arXiv IDs
from bibliographic items across all collections and supported item types. An
existing item outside the `Daily Paper` tree is shown as **In Zotero**, but its
real item key is not exposed to the report and it is never granted remove or
repair permission. New parent items created by v0.3.0 and later carry the
visible Zotero
tag `paperreader-managed-v1`. Repair and Remove require both that tag and current
membership in the `Daily Paper` collection tree. Legacy or manually created
untagged items remain presence-only even if they are already in that tree.

### 3. Confirm the attachment directory

PaperReader detects the active Zotero profile and its configured linked-file
base directory — reading `profiles.ini` and `prefs.js` under
`~/Library/Application Support/Zotero` on macOS and `%APPDATA%\Zotero\Zotero`
on Windows. If the directory is not populated automatically, choose the
same OneDrive folder in PaperReader Settings. The app compares resolved real
paths, not just display strings, and validates them again before every write.

### 4. Configure Obsidian and a provider

1. Select the dedicated Obsidian vault that will receive paper notes. Do not
   select a filesystem/home root, a broad top-level personal folder, or a path
   overlapping PaperReader user data/cache, `$CODEX_HOME`, or SSH.
2. Select **Codex**, **Claude**, or **Trae**.
3. Accept the automatically detected executable, or choose it manually.
4. Complete provider login in its own terminal CLI if not already authenticated.
5. Adjust the model and concurrency only if needed.

For cross-device notes, choose one setup: place the whole vault in OneDrive and
open that synced folder on every device, or keep the vault outside OneDrive and
use Obsidian Sync. Never run both synchronizers on the same vault. Keep the
Zotero linked-PDF directory outside the vault, and wait for sync to finish before
editing the same note on another Mac.

On a fresh configuration, first-run discovery prefers an installed Codex CLI,
then Claude, then an independently provided Trae CLI; with none detected,
onboarding remains on Codex. A provider already chosen explicitly is never
overwritten. An empty `codexModel` uses Codex's service/built-in default for the
isolated task without loading the user's `config.toml`; filling it applies an
explicit model to PaperReader jobs. The
`paper-reading` skill ships in `Resources/skills`;
the vault does not need its own copy. PaperReader resolves the bundled
`paper-reading/SKILL.md` to an absolute path and passes that exact path to the
selected CLI. Legacy vault-local skill locations remain a compatibility
fallback.

## Add-to-Zotero guarantees

Zotero and OneDrive have separate synchronization roles. Zotero Web API owns
the parent item, collection membership, tags, and linked-attachment metadata.
OneDrive owns only the PDF bytes. Zotero desktop receives metadata through
normal Zotero Sync, then resolves `attachments:<filename>.pdf` against that
device's local Linked Attachment Base Directory. Seeing a PDF in OneDrive is
therefore not evidence that the Zotero API write or desktop metadata sync has
completed.

A single user click starts the save; PaperReader does not show a redundant
second confirmation. The privileged operation still requires a recent physical
pointer/keyboard gesture in the focused window.

For each save, PaperReader:

1. normalizes the arXiv ID and obtains canonical metadata;
2. checks the Zotero profile and exact OneDrive base-directory real path;
3. downloads the PDF and validates the response, file signature, and size;
4. writes through an exclusive temporary file and atomically commits without
   replacing a conflicting existing file;
5. asks the platform cloud check to confirm an uploaded, conflict-free OneDrive
   state — macOS File Provider on Mac; on Windows the NTFS cloud-files
   placeholder attributes set by the OneDrive sync engine, which requires
   OneDrive Files On-Demand (the default) and stays fail-closed;
6. re-opens and hashes the committed PDF; and
7. creates/reconciles the Zotero parent and `linked_file` child with a flat
   `attachments:<filename>.pdf` path.

The Zotero PDF/OneDrive materialization stage has a fixed maximum concurrency
of **4**. Bursts larger than ten papers are accepted: four operations run while
the rest wait in FIFO order. The queue coalesces the same operation key while
it is queued or running, and every success or failure releases its slot. This
fixed queue is separate from AI reading concurrency; Zotero Web API work before
and after it uses its own timeout, idempotency, and reconciliation controls.

For a daily card or search result, the destination is
`Daily Paper/<report date>`. For a manually entered arXiv link, it is
`Daily Paper/<arXiv first-published date>`. The collection date can therefore
differ from the day the user clicks Add.

Metadata is not treated as success until the local file and cloud state are
confirmed. A Zotero API failure after the OneDrive commit can leave a validated,
reusable PDF in the linked directory. Keep it in place: the same-paper retry
uses deterministic identities and reconciliation rather than uploading or
creating blindly. OneDrive may show that PDF before Zotero shows metadata.
Wait for the App's final success, then run Zotero desktop Sync.

**Remove** applies only to an item that still has the
`paperreader-managed-v1` tag and remains inside the `Daily Paper` tree. It
deletes the Zotero parent/child metadata but deliberately leaves the OneDrive
PDF on disk. Untagged legacy/manual items and items outside the managed tree are
presence-only and cannot be repaired or removed by PaperReader.

## Local reading flow

```text
paper card 「帮我读」
  → trusted app bridge → bounded JobQueue
  → selected local provider
      ├─ Codex: codex exec --json --ephemeral ...
      ├─ Claude: claude -p ... --output-format stream-json
      └─ Trae: trae-cli / trae-agent exec --json ... -C <vault>
  → exact resolved path to bundled paper-reading/SKILL.md
  → normalized progress events
  → <vault>/<date>/<title>/
```

The result normally contains the Markdown note, downloaded paper, and any
attachments/code generated by the skill. If a matching folder already exists,
the card displays **笔记** and opens the note instead of launching another job.
The card displays **✓ 已读** only when the note's final
`- [ ] ✅ 已读` checkbox has been checked in Obsidian (`- [x]`). The checkbox
is the sole read-status signal; merely generating or opening a note is not.

Temporary read inputs live outside the vault in the App-owned
`~/Library/Application Support/PaperReader/paper-cache/` on macOS or
`%APPDATA%\PaperReader\paper-cache\` on Windows, passed to the provider
as `$PAPERREADER_CACHE_DIR`. On Windows, providers are spawned as native
executables (`codex.exe`, `claude.exe`, `trae-cli.exe` / `trae-agent.exe`) with
`shell: false`, and cancellation ends the whole process tree through `taskkill`. Completed jobs remove only their own intermediates;
startup sweeps abandoned scratch entries without deleting the cache root. The
finished note folder, original PDF, extracted figures, and optional code are
intentional vault content and sync with the vault.

## Settings reference

AI reading concurrency defaults to `10` and can be configured from 1–16. It is
independent of the fixed four-slot Zotero PDF/OneDrive queue described above.

All private local App files are under the App's user-data directory —
`~/Library/Application Support/PaperReader/` on macOS,
`%APPDATA%\PaperReader\` on Windows: non-secret settings are in
`config.json`, encrypted Zotero data is in `zotero-credentials.secure.json`,
downloaded report cache is in `site-cache/`, and disposable reading scratch is
in `paper-cache/`. Zotero/OneDrive linked PDFs and the selected Obsidian vault
remain at the user-chosen paths. Never attach the support directory or a vault
to a public issue without reviewing it for private paths and content.

| Setting | Default | Purpose |
|---|---|---|
| `provider` | `codex`; fresh detection prefers `codex` → `claude` → `trae` | local reading provider; an explicit choice is preserved |
| `vaultPath` | auto-detected | Obsidian notes destination |
| `zoteroLinkedAttachmentRoot` | auto-detected/empty | exact Zotero OneDrive linked-file base |
| `codexPath` | auto-detected | `codex` executable override |
| `claudePath` | auto-detected | `claude` executable override |
| `traePath` | auto-detected | `trae-cli` / `trae-agent` override |
| `pythonPath` | empty | optional "Python 3 解释器 / Python 3 interpreter" override; empty auto-probes (`python3` on macOS; `py -3`, `python`, `python3` on Windows) and the interpreter must import PyMuPDF |
| `codexModel` | empty | optional Codex model override; empty uses the isolated task's service/built-in default without loading user `config.toml` |
| `codexReasoningEffort` | empty | optional Codex reasoning override; empty uses the isolated task's service/built-in default without loading user `config.toml` |
| `model` | `sonnet` | Claude model alias |
| `traeModel` | `gpt-5.4` | Trae model; settings can refresh the live model list |
| `traeBackendVariant` | `max` | optional Trae backend variant |
| `traeReasoningEffort` | `ultra` | Trae reasoning effort |
| `concurrency` | `10` | simultaneous AI reads, clamped to 1–16; does not change Zotero PDF concurrency |
| `maxBudgetUsd` | `0` | optional Claude per-read cap; 0 disables it |
| `liveBase` | project GitHub Pages URL | latest report source; empty means offline-only |

Provider settings are preserved when switching among Codex, Claude, and Trae.

## Security boundary

Published daily HTML is data, not an authority. PaperReader serves it in a
unique-origin sandbox with a restrictive content policy. Only bundled scripts
can request a small, typed set of actions through the shell; the report cannot
read credentials, call Electron directly, choose filesystem destinations, or
make arbitrary privileged requests.

The main process additionally checks the caller frame, action schema, current
report identity, focus, and recent physical user gesture. Zotero credentials
remain in the trusted app layer and are never sent into the report iframe.

OpenAI Codex, Claude Code, and TraeCode are separate cloud providers. Their CLIs
may transmit the paper, prompt, generated context, and provider diagnostics
under their own terms. PaperReader does not collect or save their login
credentials. The Codex adapter runs `codex exec --json --ephemeral` with a named
permission profile based on `:workspace`. Reads are denied by default and are
opened only for Codex's minimal runtime, the bundled skill, the probed
Python/PyMuPDF runtime, selected vault content outside `.obsidian`, and the App
cache. The same vault content and cache are writable. System temporary
directories are denied and redirected into
the cache; network access is enabled; and interactive approvals are disabled.
Before the App reports Codex ready, it forces a real local parse of every
security-sensitive override by passing a random, deliberately missing output
schema path. Only that exact missing-file failure is accepted; the probe creates
no schema file and never invokes a model. The adapter ignores general user
config/rules, marks the vault untrusted so
project-scoped `.codex` config/hooks/rules are skipped, and disables
global/vault `AGENTS.md` discovery, plugins, apps, hooks, skill discovery, login shells, and shell
snapshots; and gives generated shell
commands only a core environment plus exact cache and Python paths. Sandboxed
commands cannot read `$CODEX_HOME`, SSH material, PaperReader settings, or
unrelated home-directory files; the vault's `.obsidian` configuration and
plugins are also unreadable and unwritable. Codex itself can still authenticate through
`codex login`. Permission profiles are a beta defense in depth, not an OS
security boundary. Claude and Trae run in their provider-specific
non-interactive bypass modes. Use only a trusted vault and account.

Paper/PDF/HTML/repository content is untrusted input. The bundled skill rejects
embedded instructions and forbids reading credentials or unrelated local files;
stop a task if a generated command or output is unrelated to paper analysis.

PaperReader has no built-in analytics or telemetry. Feature-required traffic
still goes to the public report site, arXiv, Zotero, OneDrive (macOS File
Provider or the Windows OneDrive sync engine), and the selected AI provider.
See [`../SECURITY.md`](../SECURITY.md)
for the complete data-flow and disclosure policy.

## Run from source

```bash
cd app
npm ci
npm test
npm start
```

`prestart` refreshes the bundled site snapshot before Electron launches. The app
uses Electron 43 and electron-builder 26, locked by `package-lock.json`.

## Build and release

Build both Mac architectures on macOS:

```bash
cd app
npm run dist:mac
```

Build the Windows installer on Windows x64:

```bash
cd app
npm run dist:win
```

The `Build PaperReader` GitHub Actions workflow can be run manually.
A tag matching `v*` additionally performs the candidate publication flow:

1. install dependencies with `npm ci` on macOS and Windows runners;
2. run `npm test` and the Python tests on both platforms;
3. build the unsigned Apple Silicon (`arm64`) and Intel (`x64`) DMGs on macOS
   and the unsigned `x64` NSIS installer on Windows;
4. audit the packaged apps and generate per-job checksums, merged into one
   `SHA256SUMS.txt`; and
5. publish the three installers plus the merged checksum manifest to a GitHub
   Release.

Only after the tag, Release, all three installers, and the checksum manifest
are visible and verified may the documentation call that version a published
stable release.

Complete [`../RELEASE_CHECKLIST.md`](../RELEASE_CHECKLIST.md) before tagging.

## Troubleshooting

- **API key rejected:** create a 24-character key with personal-library read
  and write access. Group-only or read-only access is insufficient. Confirm the
  Zotero desktop client is signed into the same account.
- **Directory mismatch:** re-open Zotero's active profile, confirm Linked
  Attachment Base Directory, and select that exact OneDrive folder in
  PaperReader. Aliases/symlinks do not bypass the real-path comparison.
- **Cloud confirmation unavailable:** ensure OneDrive is running, the folder is
  inside the active OneDrive container, and sync is healthy; then retry.
- **PDF is in OneDrive but Zotero has no item:** wait for the App's final result.
  If it reports success, click Zotero desktop Sync, inspect
  `Daily Paper/<report date>` for cards/search or
  `Daily Paper/<first-published date>` for manual arXiv input, then search the
  whole library by arXiv ID. Metadata sync and OneDrive sync are separate.
- **Item appears on zotero.org but not desktop:** the API write succeeded; the
  desktop Zotero metadata sync has not. Run Sync and inspect sync errors.
- **Item appears but another Mac cannot open the PDF:** on that Mac, point
  Zotero's Linked Attachment Base Directory at its local copy of the same
  OneDrive folder and wait until the PDF is downloaded, not cloud-only.
- **Add failed after committing a PDF:** keep the validated PDF unchanged and
  retry the same paper; reconciliation can reuse it.
- **Remove leaves a PDF:** expected. Remove deletes eligible managed Zotero
  metadata, never the OneDrive file.
- **Remove/repair is unavailable for an existing item:** expected for legacy or
  manual items without `paperreader-managed-v1`, or items moved outside the
  `Daily Paper` tree. They remain read-only presence matches.
- **CLI not found:** log in from Terminal and use Settings to select the actual
  `codex`, `claude`, `trae-cli`, or `trae-agent` executable.
- **Codex is not authenticated:** run `codex` in Terminal and complete its own
  ChatGPT/API login. Do not paste that credential into PaperReader. Leave
  `codexModel` empty to use the isolated task's service/built-in default;
  PaperReader does not load the user's `config.toml`.
- **Trae cannot be installed:** this release does not provide a public TraeCode
  installer. Use Codex or Claude unless you have already received a supported
  Trae CLI and account.
- **`fitz` is missing:** on macOS, ensure login-shell `python3 -c 'import fitz'`
  succeeds, add the isolated environment's `bin` directory to login-shell
  `PATH`, and restart PaperReader. On Windows, install Python 3 from
  python.org, create the environment shown above, and select its `python.exe`
  in Settings (**Python 3 解释器 / Python 3 interpreter**); the Microsoft Store
  python stub is rejected automatically.
- **Vault conflicts across devices:** use OneDrive or Obsidian Sync, not both;
  finish sync on one canonical copy before reopening it elsewhere.
- **Provider quota exhausted:** lower concurrency or switch model/provider.
  Codex, Claude, and Trae limits follow the account in their respective CLI.
- **macOS blocks first launch:** download the official release again, verify
  `SHA256SUMS.txt`, then Control-click or right-click PaperReader in Finder and
  choose **Open**. Do not disable Gatekeeper globally.
- **SmartScreen warns on first run (Windows):** verify the Setup exe against
  `SHA256SUMS.txt` first, then choose **More info** → **Run anyway** for this
  one file. Do not turn off SmartScreen, Defender, or other Windows security
  features globally.
- **OneDrive cloud state never confirms (Windows):** keep OneDrive running and
  signed in, keep Files On-Demand enabled, and make sure the linked folder is
  inside the signed-in account's OneDrive sync folder; a paused or signed-out
  sync client is never treated as confirmation.

## Important files

| File | Role |
|---|---|
| `main.js` | BrowserWindow lifecycle, hardened report serving, credentials, IPC, file/cloud orchestration |
| `preload.js` | narrow `window.paperBridge` API |
| `renderer.js` / `shell.html` | trusted shell, navigation, jobs, Zotero controls |
| `report-sandbox.js` / `report-gesture.js` | report content policy and physical-gesture gate |
| `zotero-credentials.js` / `zotero-key-verify.js` | secure storage and Zotero key verification |
| `zotero-profile.js` | active profile and linked-directory discovery (macOS and Windows layouts) |
| `zotero-linked-store.js` | validated, atomic linked-PDF materialization |
| `onedrive-cloud-verify.js` | cloud upload confirmation: macOS File Provider / Windows cloud-files placeholder attributes |
| `zotero-pdf-queue.js` | fixed four-slot FIFO queue for PDF/OneDrive materialization |
| `zotero-save.js` | idempotent Zotero item/attachment reconciliation |
| `job-queue.js` | provider routing, concurrency, cancel, watchdog |
| `spawn-codex.js` / `spawn-claude.js` / `spawn-trae.js` | local provider adapters |
| `skill-locator.js` | bundled skill lookup and legacy fallback |
| `vault-scan.js` / `cache-clean.js` | already-read detection and cache cleanup |
| `sync-site.js` | minimal read-only report snapshot for packaging |
