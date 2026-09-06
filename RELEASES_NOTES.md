# v0.3.1

[中文发布说明](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/main/RELEASES_NOTES_ZH.md)

PaperReader v0.3.1 adds a Windows 10/11 x64 installer alongside the macOS builds.

## What's new

- Windows support for saving papers to Zotero with OneDrive-linked PDFs, local AI reading with Codex, Claude or Trae, Obsidian notes, read-status detection, and fetching the latest daily reports.
- Windows detection of Zotero profiles, OneDrive folders, Python, and installed AI CLIs.
- An optional Python 3 interpreter setting for selecting an installation with PyMuPDF. Figure repair now uses the selected interpreter on both platforms.

## Downloads

Download the installer for your system and `SHA256SUMS.txt` from the [v0.3.1 Release](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1):

- `PaperReader-0.3.1-arm64.dmg`: Apple Silicon Macs, macOS 12 or later.
- `PaperReader-0.3.1-x64.dmg`: Intel Macs, macOS 12 or later.
- `PaperReader-0.3.1-x64-Setup.exe`: Windows 10/11 x64, with a per-user installer and a choice of install directory.
- `SHA256SUMS.txt`: SHA-256 checksums for all three installers.

Check the download against `SHA256SUMS.txt` before opening it. All three installers are unsigned; the macOS builds are also unnotarized, so the operating system may block the first launch. A checksum detects a damaged download but does not replace code signing. See the [installation guide](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/main/app/README.md) for verification, first-launch steps, and configuration.

## Upgrading

Updates are installed manually. On macOS, quit PaperReader and replace the app in `/Applications` with the verified new version. Settings, cached reports, and encrypted Zotero credentials remain in `~/Library/Application Support/PaperReader/`; keep that directory when upgrading.

v0.3.0 had no Windows installer, so v0.3.1 is a new installation on Windows. The Windows installer stores user data in `%APPDATA%\PaperReader\` and retains it on uninstall.

If you move your OneDrive folder or switch Zotero profiles, check the linked-attachment directory in PaperReader Settings before saving more papers.

> **For v0.2 users:** revoke and replace every Zotero API key and WebDAV password stored in the retired encrypted website bundle. Those credentials may remain in earlier Git history; upgrading does not revoke them.

## Limitations

- Windows arm64 and Linux are not supported.
- On Windows, the linked-attachment directory must be inside your signed-in account's OneDrive folder, with Files On-Demand enabled. PaperReader checks local sync status before writing Zotero metadata.
- If Zotero rejects a save after the PDF has been copied, the PDF may remain in OneDrive. Retry the paper after resolving the error. Removing a managed Zotero item does not delete its linked PDF.
- AI reading requires a separately installed and authenticated provider CLI, plus Python 3 with PyMuPDF. Availability and usage limits depend on your provider account.

See the [Security Policy](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/main/SECURITY.md) for credential storage, AI permissions, and data handling.
