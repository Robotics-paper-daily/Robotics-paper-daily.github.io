# PaperReader v0.3.1 for macOS and Windows

[中文发布说明](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/v0.3.1/RELEASES_NOTES_ZH.md)

PaperReader v0.3.1 extends the desktop app to Windows: the release ships two macOS DMGs and a Windows 10/11 x64 installer with the same feature set. Zotero saves and local AI-assisted reading stay in the app; the public GitHub Pages site remains a read-only paper archive.

> **Security action for v0.2 users:** revoke and recreate every Zotero API key and WebDAV password that was ever placed in the retired encrypted website bundle. v0.3.1 does not use that bundle, but removing it from the current tree cannot revoke credentials preserved in earlier Git history.

## Release assets

The app release contains three installers and one merged checksum manifest:

- `PaperReader-0.3.1-arm64.dmg` for Apple Silicon Macs (macOS 12+);
- `PaperReader-0.3.1-x64.dmg` for Intel Macs (macOS 12+);
- `PaperReader-0.3.1-x64-Setup.exe` for Windows 10 and Windows 11 on x64 — an NSIS per-user installer with a choosable install directory; and
- `SHA256SUMS.txt` covering all three installers.

Download the matching installer and `SHA256SUMS.txt` attached to this Release. If you are reading this file in the repository, use the official [Releases page](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases).

Verify the download before opening it. On macOS:

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
# Compare the printed hash with the PaperReader-0.3.1-x64-Setup.exe line in SHA256SUMS.txt.
```

or in Git Bash:

```bash
grep 'PaperReader-0.3.1-x64-Setup.exe$' SHA256SUMS.txt | sha256sum -c -
```

Run only the command for the file you downloaded. It must report `OK` (or a hash that matches the manifest exactly).

All three installers are unsigned. A checksum detects corruption, but it does not replace Apple notarization or Windows Authenticode signing and cannot prove provenance if the release channel itself is compromised.

v0.3.1 supports macOS 12+ (`arm64`, `x64`) and Windows 10/11 (`x64`). Windows arm64 is not built, and Linux remains unsupported. `app/run-windows.bat` is still an experimental source-development launcher, not a product or installer; the supported Windows entry point is the Setup installer. The Windows implementation record and remaining hardening backlog are in the [Windows roadmap](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/v0.3.1/docs/WINDOWS_ROADMAP.md).

## What's new in v0.3.1

### Windows 10/11 (x64) support

- PaperReader now runs on Windows 10 and Windows 11 (x64) with functionality identical to macOS: **Add to Zotero** with OneDrive-linked attachments, **「帮我读」** local AI deep reading through the Codex/Claude/Trae CLIs, Obsidian notes, read-status detection, and live report fetching.
- Zotero profile detection reads `%APPDATA%\Zotero\Zotero` (`profiles.ini` plus `prefs.js`), the Windows counterpart of `~/Library/Application Support/Zotero` on macOS.
- The OneDrive linked-attachment root must be inside the signed-in account's OneDrive sync folder. PaperReader discovers roots from the per-user `OneDrive` / `OneDriveConsumer` / `OneDriveCommercial` environment variables and compares resolved real paths case-insensitively.
- Cloud upload confirmation polls the file's NTFS cloud-files placeholder attributes — the reparse-point state the OneDrive sync engine sets once the file is uploaded and in sync — instead of macOS `fileproviderctl`, and it stays fail-closed: no confirmation means no Zotero metadata write. OneDrive Files On-Demand must be enabled (it is the default on current OneDrive).
- Python detection on Windows tries `py -3`, then `python`, then `python3`, persists the exact resolved `python.exe`, and rejects the Microsoft Store python stub automatically.
- Providers spawn native executables (`codex.exe`, `claude.exe`, `trae-cli.exe` / `trae-agent.exe`) directly with `shell: false`; cancellation uses `taskkill` on the process tree.
- App data lives under `%APPDATA%\PaperReader\`: `config.json`, `zotero-credentials.secure.json` encrypted with Electron `safeStorage` backed by Windows DPAPI, `site-cache/`, and `paper-cache/`. Manual upgrades preserve it, and uninstall keeps this per-user data.
- The bundled `paper-reading` skill is shell-agnostic: POSIX examples are paired with PowerShell equivalents (`$env:VAR`, `Copy-Item`, `Get-ChildItem`).

### macOS and shared changes

- macOS functionality is unchanged from v0.3.0; the mac DMGs remain unsigned and unnotarized.
- Figure repair now uses the probed Python interpreter instead of assuming a `python3` on `PATH`.
- Python detection is hardened, and a new optional Settings field — **Python 3 解释器 / Python 3 interpreter** — lets users point PaperReader at a specific interpreter; the selected interpreter must be able to import PyMuPDF (`fitz`).

### Build and release pipeline

- CI builds the macOS DMGs on `macos-latest` and the Windows installer on `windows-latest`: locked `npm ci`, dependency audit, Node and Python tests, electron-builder NSIS packaging, a packaged privacy audit, and per-job checksums. The tag-triggered release publishes the three installers plus the merged `SHA256SUMS.txt`.
- Distribution remains manual download-verify-replace; the app never fetches or applies new versions on its own.

## Install and configure

1. Verify the installer as shown above, then install. macOS: open the DMG and drag PaperReader to Applications. Windows: run `PaperReader-0.3.1-x64-Setup.exe`, a per-user NSIS installer that lets you choose the install directory.
2. First launch of an unsigned build: on macOS, Control-click or right-click PaperReader in Finder, choose **Open**, then confirm **Open** — do not disable Gatekeeper globally. On Windows, if Microsoft Defender SmartScreen warns, choose **More info** → **Run anyway** for this one verified file — do not weaken SmartScreen or other system security globally.
3. Install and run Zotero and OneDrive. Sign Zotero into the same personal library account as the API key, enable Zotero Sync, and complete one sync.
4. Set Zotero's Linked Attachment Base Directory to a folder inside OneDrive. On Windows that folder must be inside the signed-in account's OneDrive sync folder, with Files On-Demand enabled (the default).
5. Create a 24-character Zotero API key with personal-library read/write access, paste it into PaperReader Settings, and save it after verification.
6. Confirm the detected Zotero profile and OneDrive attachment directory.
7. To use **「帮我读」**, select a dedicated Obsidian vault and a logged-in Codex or Claude CLI, or an independently provisioned Trae CLI. Do not select a filesystem root, home directory, broad top-level home folder, or a path that overlaps PaperReader data, `$CODEX_HOME`, or SSH files.
8. Provide Python 3 with PyMuPDF. macOS: confirm login-shell `python3 -c 'import fitz'` succeeds. Windows: install Python 3 from python.org (it includes the `py` launcher), then for example `py -3 -m venv %USERPROFILE%\.paperreader-python` and `%USERPROFILE%\.paperreader-python\Scripts\python.exe -m pip install "PyMuPDF>=1.24,<2"`, and select that `python.exe` in PaperReader Settings (or ensure `py -3 -c "import fitz"` works).

See the [PaperReader guide](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/v0.3.1/app/README.md) for the complete walkthrough and troubleshooting.

## Upgrade from v0.3.0

- Upgrades are a manual download-verify-replace flow on both platforms; settings, report cache, and encrypted Zotero credentials are preserved.
- macOS: quit PaperReader, verify the new DMG, and replace the app in `/Applications`. Do not delete `~/Library/Application Support/PaperReader/`.
- Windows: v0.3.0 had no Windows build, so v0.3.1 is a fresh install on Windows machines. Later Windows upgrades run the newer Setup exe over the existing installation, which preserves `%APPDATA%\PaperReader\`.
- Existing linked attachments remain valid while Zotero's Linked Attachment Base Directory resolves to the same OneDrive folder. Reconfirm the directory after moving OneDrive storage or switching Zotero profiles.
- Browser-personal-mode credentials are not imported. Rotate every key or WebDAV password previously used by v0.2.

## Known limitations

- All three installers are unsigned: the DMGs are not notarized, and the Windows installer carries no Authenticode signature.
- First launch therefore needs one explicit per-file step: Finder's right-click **Open** on macOS, or SmartScreen's **More info** → **Run anyway** on Windows after the SHA-256 has been verified. Never disable Gatekeeper, SmartScreen, or other OS security globally.
- Windows arm64 is not built; only x64 is supported on Windows.
- Linux remains unsupported; it is the next planned platform target, with no promised date.
- On Windows, OneDrive Files On-Demand must stay enabled; cloud confirmation cannot succeed without the sync engine's placeholder state.
- Uninstalling on Windows keeps the per-user data in `%APPDATA%\PaperReader`; delete that folder manually for a full cleanup.
- A late Zotero API failure can leave a validated PDF in OneDrive. Retrying the same paper is safe; removing a managed Zotero item does not remove that file.
- AI-provider availability and quota depend on the user's local provider account.

For the complete security and privacy model, read the [Security Policy](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/v0.3.1/SECURITY.md).
