# PaperReader v0.3.1

[中文版本](README_ZH.md) · [Windows roadmap](../docs/WINDOWS_ROADMAP.md) · [Security](../SECURITY.md)

PaperReader is the desktop companion to Robotics Daily Papers. Browse daily reports, save papers to Zotero, and use a local AI CLI to create reading notes in Obsidian. The public website provides read-only reports; Zotero and note-writing controls are available in the desktop app.

v0.3.1 is available on [GitHub Releases](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1):

| Platform | Installer |
|---|---|
| macOS 12+, Apple Silicon (M1 and newer) | `PaperReader-0.3.1-arm64.dmg` |
| macOS 12+, Intel | `PaperReader-0.3.1-x64.dmg` |
| Windows 10 and Windows 11, `x64` | `PaperReader-0.3.1-x64-Setup.exe` |

The release also includes `SHA256SUMS.txt`. Windows `arm64` and Linux installers are not available.

## Download and install

Download the installer for your machine and `SHA256SUMS.txt` from the release above. Both macOS installers are unsigned and unnotarized; the Windows installer has no Authenticode signature. SHA-256 checks detect a damaged or mismatched download, but do not replace code signing or establish authenticity if the release channel is compromised.

### macOS

In Terminal, open your Downloads directory and run the command matching your Mac:

```bash
cd ~/Downloads
# Apple Silicon
grep 'PaperReader-0.3.1-arm64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
# Intel
grep 'PaperReader-0.3.1-x64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
```

After the check reports `OK`, open the DMG and drag PaperReader to Applications. If macOS blocks the first launch because the developer is unidentified or the app is not notarized, follow the per-app approval steps in [Troubleshooting](#troubleshooting).

### Windows

In PowerShell, open your Downloads directory and calculate the installer hash:

```powershell
Set-Location "$env:USERPROFILE\Downloads"
Get-FileHash .\PaperReader-0.3.1-x64-Setup.exe -Algorithm SHA256
```

Compare the hash with the matching line in `SHA256SUMS.txt`. Once they match, run the Setup installer and choose an installation directory. It installs for the current user. If Microsoft Defender SmartScreen warns and you trust the downloaded file, choose **More info** → **Run anyway**. These options may be unavailable on a managed device.

### Upgrading and uninstalling

PaperReader does not download or install new app versions. To upgrade, quit the app, download and verify the newer installer, then replace the existing app in Applications on macOS or run the newer Setup installer on Windows.

Settings, cached reports, and encrypted Zotero credentials are kept in `~/Library/Application Support/PaperReader/` on macOS or `%APPDATA%\PaperReader\` on Windows. Replacing the app reuses these files. Windows uninstall also preserves this directory; remove it separately only if you want to clear the local data. Your Obsidian vault and OneDrive PDFs remain in the locations you selected.

## Requirements

Reading the daily reports requires only PaperReader. To use **Add to Zotero**, install Zotero desktop and OneDrive, sign in to both, and keep them running. Windows also requires OneDrive Files On-Demand to remain enabled.

For **帮我读** (Read with AI), prepare:

- A dedicated Obsidian vault containing `.obsidian/`. Use a folder for paper notes, not your home directory or an entire `Documents` or `Downloads` directory. The vault must not overlap PaperReader's settings or cache. Codex also rejects vaults overlapping `$CODEX_HOME` or SSH directories.
- One installed and authenticated AI CLI: [OpenAI Codex CLI (`codex`)](https://developers.openai.com/codex/cli/), [Claude Code (`claude`)](https://docs.anthropic.com/en/docs/claude-code/getting-started), or an independently provided TraeCode CLI (`trae-cli` / `trae-agent`). PaperReader does not distribute or provide accounts for TraeCode CLI.
- Python 3 with PyMuPDF (`fitz`) for PDF extraction.

The app uses the login session managed by the selected CLI. It does not collect or save AI-service credentials. Available models, usage limits, and charges follow that account.

### Python on macOS

Create an isolated environment:

```bash
python3 -m venv "$HOME/.paperreader-python"
"$HOME/.paperreader-python/bin/python3" -m pip install 'PyMuPDF>=1.24,<2'
"$HOME/.paperreader-python/bin/python3" -c 'import fitz; print(fitz.VersionBind)'
```

In PaperReader settings, select this environment's `python3` under **Python 3 解释器** (Python 3 interpreter). To use automatic detection instead, add `$HOME/.paperreader-python/bin` to your login-shell `PATH` and restart PaperReader.

### Python on Windows

Install Python 3 and its `py` launcher from [python.org](https://www.python.org/downloads/), then run in PowerShell:

```powershell
py -3 -m venv "$env:USERPROFILE\.paperreader-python"
& "$env:USERPROFILE\.paperreader-python\Scripts\python.exe" -m pip install "PyMuPDF>=1.24,<2"
& "$env:USERPROFILE\.paperreader-python\Scripts\python.exe" -c "import fitz; print(fitz.VersionBind)"
```

Select that `python.exe` under **Python 3 解释器** in PaperReader settings. When the field is empty, the app tries `py -3`, `python`, and `python3` in order. It rejects Microsoft Store launch stubs and requires the detected interpreter to import PyMuPDF successfully.

## First-run setup

PaperReader currently uses Chinese interface labels. The steps below quote those labels with English explanations.

### Zotero and OneDrive

1. Sign in to Zotero desktop with the personal-library account you will use in PaperReader. Enable Zotero Sync and complete one manual sync.
2. Start OneDrive and wait until it is signed in and syncing.
3. In Zotero, open **Settings → Advanced → Files and Folders**. Set **Linked Attachment Base Directory** to a dedicated folder inside OneDrive, such as `OneDrive/Zotero-Attachments`.
4. Open [Zotero's key creation page](https://www.zotero.org/settings/keys/new). Create a private 24-character API key with personal-library read and write access.
5. Open PaperReader settings, paste the key into **Zotero API Key**, and choose **验证并安全保存** (Verify and securely save) or **保存全部设置** (Save all settings). The user ID is detected from the key; you do not need to enter it.
6. Check **Zotero 链接附件基准目录** (Zotero linked attachment base directory). If the app has not filled it in, select the same OneDrive folder configured in Zotero.

The folder must be within the current OneDrive account's local sync directory and match Zotero's active profile. PaperReader checks the actual resolved path, including links and aliases, before writing. After moving the folder or switching Zotero profiles, confirm the path again.

Zotero credentials are encrypted using the operating system's secure-storage facility: Keychain-backed storage on macOS and DPAPI on Windows. If encryption is unavailable, the app refuses to save the key. The settings page does not reveal a saved key; leaving the field blank keeps it unchanged.

If you used the retired v0.2 browser integration, revoke any Zotero key or WebDAV password saved in that integration before entering replacement credentials.

### Obsidian and AI reading

1. Select your paper-note vault under **Obsidian 笔记库路径** (Obsidian vault path).
2. Choose **Codex**, **Claude**, or **Trae** under **本地 AI CLI**. The app detects an installed CLI; use the file picker if detection fails.
3. Complete login in the selected CLI's own terminal interface.
4. Select a Python interpreter as described above, then choose **重新检测** (Check again).
5. Once the required checks pass, choose **保存全部设置** (Save all settings).

On first setup, discovery prefers Codex, then Claude, then Trae. It preserves a provider you have already selected. The `paper-reading` skill is bundled with the app; you do not need to install it in the vault.

For notes across devices, use either a vault in OneDrive or a vault outside OneDrive with Obsidian Sync. Do not use both synchronizers on the same vault. Keep Zotero's linked-PDF directory outside the vault, and wait for sync to finish before editing the same note on another device.

## Saving papers to Zotero

Choose **Add to Zotero** on a paper card or search result, or enter an arXiv link. PaperReader downloads and validates the PDF, checks local OneDrive file state, and creates the Zotero item and linked attachment. Zotero syncs the library record; OneDrive syncs the PDF. Wait for PaperReader's final success, then sync Zotero desktop to see the new item.

On Windows, the current check only tests the local reparse-point attribute. It does not prove that the PDF has finished uploading, has no cloud conflict, or is available on another device. Confirm synchronization in OneDrive before relying on cross-device access; further real-device validation is tracked in the [Windows roadmap](../docs/WINDOWS_ROADMAP.md).

The Zotero PDF/OneDrive queue has a fixed concurrency of **4**. Additional papers wait in submission order (FIFO), including batches larger than ten. Repeated requests for the same paper operation are merged while queued or running. This queue is independent of AI reading concurrency.

Cards and search results are saved under `Daily Paper/<report date>`. Manually entered arXiv links use `Daily Paper/<arXiv first-published date>`, which may differ from the day you save the paper.

If a save fails after the PDF is written to the OneDrive folder, leave that file in place and retry the same paper. PaperReader can reuse the validated file and reconcile an existing Zotero item. A PDF appearing in OneDrive alone does not mean the complete save succeeded.

PaperReader also checks the personal library for existing arXiv papers. Existing items are shown as **In Zotero**, **已在库中**, or **已在 Zotero** (Already in Zotero), depending on the view, without creating another copy. Repair and removal are available only for items with the `paperreader-managed-v1` tag that still belong to the `Daily Paper` collection tree. Legacy or manually created items without that tag remain read-only in PaperReader, even when they are inside that tree.

Removing an eligible item deletes its Zotero record and linked-attachment record. It leaves the PDF in OneDrive.

## Reading papers and opening notes

Choose **帮我读** on a paper card to start an AI reading task. Progress appears in the app. The resulting folder, `<vault>/<date>/<title>/`, normally contains a Markdown note, the original PDF, and extracted figures. When the paper provides an open-source implementation, the task also downloads relevant source files.

If a matching note already exists, the card shows **笔记** (Note) and opens it. To mark the paper as read, check the final `- [ ] ✅ 已读` checkbox in Obsidian so it becomes `- [x]`. Only this checkbox changes the card to **✓ 已读**; generating or opening the note does not mark it read.

Temporary extraction files are stored outside the vault in PaperReader's `paper-cache/` directory and cleaned after the task. Completed notes, PDFs, figures, and downloaded source files stay in the vault and sync with it.

## Settings

AI reading concurrency defaults to `10` and can be set from 1–16. It is independent of the fixed Zotero PDF queue. Lower it if your AI account reaches a usage limit or tasks often wait for capacity.

| Setting | Default | Meaning |
|---|---|---|
| `provider` | Codex; first setup detects available CLIs | AI service used for reading |
| `vaultPath` | Detected when possible | Obsidian note destination |
| `zoteroLinkedAttachmentRoot` | Detected when possible | OneDrive folder configured in Zotero |
| `codexPath`, `claudePath`, `traePath` | Detected | Optional CLI executable paths |
| `pythonPath` | Detected | Python interpreter with PyMuPDF installed |
| `codexModel` | Empty | Uses the isolated task's default model; set a name to select a model explicitly |
| `codexReasoningEffort` | Empty | Uses the isolated task's default reasoning effort |
| `model` | `sonnet` | Claude model alias |
| `maxBudgetUsd` | `0` | Claude per-read budget in USD; `0` disables the cap |
| `traeModel` | `gpt-5.4` | Trae model; refresh its available models in settings |
| `traeBackendVariant` | `max` | Trae context mode |
| `traeReasoningEffort` | `ultra` | Trae reasoning effort |
| `concurrency` | `10` | Simultaneous AI reads, from 1–16 |
| `liveBase` | Project GitHub Pages URL | Daily report source; empty uses offline content |

Switching providers preserves each provider's settings. Codex tasks do not load your personal `config.toml`; select any required model or reasoning settings in PaperReader.

## Privacy and permissions

AI reading sends paper content, prompts, and generated context to the selected AI service through its CLI. Its own terms also govern diagnostics and account usage. PaperReader does not collect AI login credentials or include analytics or telemetry. Report retrieval and Zotero saving connect to the report website, arXiv, Zotero, and OneDrive.

Codex tasks can read the required runtime, bundled skill, Python environment, selected vault content outside `.obsidian`, and app reading cache. They can write the allowed vault content and cache, and access the network. Task commands cannot read `$CODEX_HOME`, SSH files, PaperReader settings, or unrelated home-directory files; `.obsidian` settings and plugins are excluded from both reading and writing. Codex itself still uses its existing CLI login. This permission configuration is a beta additional safeguard, not a complete operating-system security boundary.

Claude and Trae use their own non-interactive modes with permission prompts bypassed. They do not receive the same file-access restrictions as Codex. Use a dedicated vault and only run tasks with a CLI account you trust.

Published report pages cannot access Zotero credentials or write directly to your files. Papers, PDFs, web pages, and linked repositories are still untrusted inputs; stop a reading task if its commands or output are unrelated to paper analysis. See the [security policy](../SECURITY.md) for implementation details and vulnerability reporting.

## Troubleshooting

- **API key rejected:** use a 24-character key with personal-library read and write access. Group-only or read-only access is insufficient. Confirm Zotero desktop uses the same account.
- **Attachment directory mismatch:** check the active Zotero profile and select the same OneDrive folder in PaperReader. A shortcut or symbolic link does not bypass this check.
- **OneDrive file-state check fails:** check that OneDrive is running, signed in, and syncing the selected directory. On Windows, keep Files On-Demand enabled. Retry after sync resumes.
- **PDF is in OneDrive but the Zotero item is missing:** wait for the app's final result. After success, sync Zotero desktop and search by arXiv ID. Check `Daily Paper/<report date>` for cards/search or `Daily Paper/<first-published date>` for manual arXiv links.
- **Item appears on zotero.org but not in Zotero desktop:** run Zotero Sync and check its sync errors.
- **Another device cannot open the linked PDF:** set Zotero's Linked Attachment Base Directory to that device's local copy of the same OneDrive folder and wait for the PDF to download.
- **A failed save left a PDF behind:** keep the file and retry the same paper. Removing a Zotero item also leaves its OneDrive PDF in place.
- **An existing item cannot be repaired or removed:** check that it has the `paperreader-managed-v1` tag and remains inside `Daily Paper`. Other items are read-only in PaperReader.
- **CLI not found or not logged in:** install and log in to the selected CLI in a terminal, then select its executable in settings. Trae requires a separately provided CLI and account.
- **`fitz` is missing:** follow the Python setup above and select that environment's interpreter. Choose **重新检测** to check it again.
- **Notes conflict across devices:** use only one sync service for the vault and let the latest copy finish syncing before opening it elsewhere.
- **AI quota exhausted:** lower **AI 精读并发数** (AI reading concurrency), change the model, or use another configured provider. This does not change Zotero's four-task PDF queue.
- **macOS warns about an unidentified developer or missing notarization:** verify that you trust the official download, try opening it, then go to **System Settings → Privacy & Security → Open Anyway → Open**. Older macOS versions use **System Preferences → Security & Privacy**. See [Apple's instructions](https://support.apple.com/en-us/102445). These steps do not apply to damaged-app or malware warnings; do not disable Gatekeeper globally.
- **SmartScreen warns on Windows:** verify the installer, then use **More info → Run anyway** if available and you trust the file. Managed-device policy may prevent this. Do not disable SmartScreen or Defender globally.

For support, review logs or screenshots before sharing them. The app's data directory contains `config.json`, encrypted `zotero-credentials.secure.json`, cached reports in `site-cache/`, and temporary files in `paper-cache/`; do not attach the directory or your vault to a public issue without removing private information.

## Development

Run from source on macOS or Windows:

```bash
cd app
npm ci
npm test
npm start
```

The app uses Electron 43 and electron-builder 26, with versions locked in `package-lock.json`. `prestart` refreshes the bundled report snapshot. `run-windows.bat` is a source-development helper, not a product installer; use the Setup installer for normal Windows use.

Build the macOS installers on macOS with `npm run dist:mac`, or the Windows installer on Windows x64 with `npm run dist:win`. The `Build PaperReader` workflow runs tests, builds and audits packages, and generates checksums. A `v*` tag also publishes the three installers and merged `SHA256SUMS.txt` to GitHub Releases. Maintainer steps are in the [release checklist](../RELEASE_CHECKLIST.md); Windows implementation and remaining work are in the [Windows roadmap](../docs/WINDOWS_ROADMAP.md).

| File | Role |
|---|---|
| `main.js`, `preload.js` | App lifecycle, local operations, and the report bridge |
| `renderer.js`, `shell.html` | Navigation, reading tasks, and Zotero controls |
| `report-sandbox.js`, `report-gesture.js` | Report isolation and user-action checks |
| `zotero-credentials.js`, `zotero-key-verify.js` | Credential encryption and key verification |
| `zotero-profile.js` | Zotero profile and attachment-directory detection |
| `zotero-linked-store.js`, `onedrive-cloud-verify.js` | PDF validation, local storage, and OneDrive file-state checks |
| `zotero-pdf-queue.js`, `zotero-save.js` | PDF queue and Zotero item handling |
| `job-queue.js`, `spawn-codex.js`, `spawn-claude.js`, `spawn-trae.js` | AI task scheduling and CLI adapters |
| `skill-locator.js`, `vault-scan.js`, `cache-clean.js` | Bundled skill, note detection, and temporary-file cleanup |
| `sync-site.js` | Bundled report snapshot |
