# Security policy

[中文版本](SECURITY_ZH.md)

## Supported versions and platforms

Security fixes cover the current `main` branch and the latest PaperReader desktop release on the official [GitHub Releases](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases) page, currently v0.3.1.

| Software or platform | Status |
|---|---|
| Current `main` branch | Supported |
| PaperReader v0.3.1 for macOS 12+ (`arm64`, `x64`) | Released; supported |
| PaperReader v0.3.1 for Windows 10/11 (`x64`) | Released; supported |
| Older desktop releases | Upgrade to the latest release for fixes |
| Retired v0.2 browser writer | Unsupported; do not use |
| Windows `arm64` and Linux | Unsupported; no official installer |

The v0.2 WebDAV upload flow and encrypted website credential bundle are retired. See [Credential handling and migration](#credential-handling-and-migration) if you used that version.

## Report a vulnerability

Use the repository's **Security > Report a vulnerability** form when available. Include the affected version, platform, minimal reproduction, and impact. Omit real API keys, passwords, private papers, vault notes, and unredacted App-support files.

If private reporting is unavailable, open a minimal public issue asking for a private channel. Keep exploit details and secrets out of the issue. Maintainers will acknowledge a usable report and coordinate disclosure after a fix is available.

Only test accounts, devices, libraries, vaults, and deployments you own or are authorized to test.

## Scope

This policy covers:

- Credential storage, permission checks, and migration in supported code and desktop releases.
- Report iframe sandboxing, the App bridge, IPC allowlists, and user-gesture validation.
- Data flows PaperReader initiates through Zotero, OneDrive, Obsidian, and local AI CLIs.
- Path validation, file writes, cache cleanup, package contents, and release integrity.
- Handling of untrusted papers, PDFs, HTML, repositories, and AI output.

It does not cover the retired v0.2 browser writer, unsupported platforms, or vulnerabilities wholly within an external service unless PaperReader's integration causes the issue. Provider billing, quotas, retention policies, and service availability are also outside this project's scope.

## Data and trust boundaries

The paths below use the macOS layout. On Windows, PaperReader stores the corresponding files under `%APPDATA%\PaperReader\`.

| Data or action | Destination | Handling |
|---|---|---|
| Public reports | Project GitHub Pages and local cache | Treated as untrusted content and displayed in a sandboxed iframe |
| Zotero API key and user ID | `~/Library/Application Support/PaperReader/zotero-credentials.secure.json` | Encrypted with Electron `safeStorage`, backed by Keychain on macOS and DPAPI on Windows; no plaintext fallback |
| App settings | `~/Library/Application Support/PaperReader/config.json` | Stored locally; may contain private filesystem paths |
| Report cache | `~/Library/Application Support/PaperReader/site-cache/` | Public report data cached locally |
| Reading temporary files | `~/Library/Application Support/PaperReader/paper-cache/` | Outside the vault; shared with the AI CLI through `$PAPERREADER_CACHE_DIR` |
| Zotero metadata | Zotero Web API and Zotero Sync | Requires a personal-library read/write key; credentials are not passed to report HTML |
| Linked PDFs | User-selected OneDrive folder | Synced by OneDrive, separately from Zotero metadata |
| Completed notes | User-selected Obsidian vault | May include paper text, figures, code excerpts, and private annotations |
| AI reading requests | Selected Codex, Claude Code, or Trae CLI | May send papers, prompts, context, and diagnostics to the provider under its terms |

The public website is read-only. It does not receive Zotero credentials, write OneDrive files, start a local AI CLI, or modify a vault.

Before writing Zotero metadata, PaperReader checks OneDrive's local state. macOS checks File Provider's upload and conflict status. Windows currently checks only the file's reparse-point attribute, which does not prove that uploading has finished or that the cloud copy is conflict-free. If the platform check does not pass, the save stops. Neither platform downloads or compares the remote PDF; confirm OneDrive has finished syncing before using the PDF on another device.

## Local AI permissions and network use

PaperReader passes the bundled `paper-reading/SKILL.md` to the selected AI CLI. AI reading can write notes and attachments in the selected vault and use the App's reading cache. Network access is enabled, and the provider may receive content from those locations. Choose a dedicated vault and review the provider's privacy, retention, and billing terms.

The Codex adapter uses a named permission profile based on `:workspace`. It grants reads to the minimum runtime, bundled skill, selected Python/PyMuPDF runtime, vault content outside `.obsidian`, and App cache. Vault content and cache are writable. The profile denies access to Codex configuration and credentials in `$CODEX_HOME`, SSH files, PaperReader settings, `.obsidian`, and unrelated home-directory files. Temporary files are directed into the App cache. Codex itself still authenticates through `codex login`.

The adapter checks that the installed Codex CLI can parse its permission settings before reporting it ready; this local check does not invoke a model. For reading jobs, it skips user and project configuration, execution-policy rules, and `AGENTS.md` discovery. It also disables plugins, apps, hooks, skill discovery, login shells, and shell snapshots, and supplies a restricted shell environment. These beta permission profiles add protection but do not provide a complete operating-system security boundary.

Claude and Trae use their own non-interactive modes that bypass permission prompts. They do not receive the Codex permission profile, so the same file-access restrictions must not be assumed for those providers.

PaperReader rejects the filesystem root, the home directory, its ancestors, and broad home folders such as `Documents`, `Downloads`, `Library`, `.config`, `.local`, `.codex`, and `.ssh` as vaults. A dedicated nested folder is allowed. For Codex, the vault must also be separate from PaperReader data and cache, `$CODEX_HOME`, and the user's SSH directory.

Papers, PDFs, project pages, repositories, citations, and metadata may contain prompt injection. The bundled skill instructs the AI to treat that content as data, ignore embedded instructions, and avoid credentials or unrelated local files. Those instructions cannot guarantee that an AI will follow them or block every injection. Stop a job if its commands or output are unrelated to paper analysis.

Install and authenticate AI CLIs separately. Codex uses its own ChatGPT/API authentication, and Claude uses its own subscription/OAuth session. Trae support requires an independently obtained, supported CLI and account. PaperReader does not collect or store AI-provider credentials.

PaperReader has no built-in analytics or telemetry. Its features still contact the public report site, arXiv, Zotero, OneDrive, and the selected AI provider. Those services may apply their own logging and telemetry policies.

## Credential handling and migration

- Keep Zotero keys, WebDAV passwords, AI credentials, and OneDrive tokens out of source, screenshots, logs, test fixtures, issues, and release files. Redact private paths before sharing diagnostics.
- Use a Zotero key for the same personal-library account as Zotero desktop, with only the required library read/write permissions.
- If you used v0.2, revoke and replace every Zotero key and WebDAV password stored in the old website bundle. Deleting a file from the current revision does not erase Git history or revoke credentials.
- Clearing the key in PaperReader deletes the local encrypted credential file. Removing the App alone retains its user data for later installation or upgrades.
- Do not publish the App-support directory. Even encrypted files and settings can reveal usernames, paths, selected providers, or library structure.

## Release integrity

The [v0.3.1 Release](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1) provides two macOS DMGs, one Windows installer, and `SHA256SUMS.txt`. All installers are unsigned: the macOS builds have no Developer ID signature or Apple notarization, and the Windows installer has no Authenticode signature.

Download the installer and checksum list from the same official Release, and follow the verification steps in the [installation guide](app/README.md). A SHA-256 match detects a damaged download. It does not replace signing or prove authenticity if the release account or download channel is compromised.

macOS or Windows may block an unsigned app. First-launch steps depend on the operating-system version and security policy; follow the installation guide and only make an exception for a download you trust. Keep Gatekeeper, SmartScreen, Defender, and other system protections enabled.

Maintainer checks for tests, credential scans, installer audits, and checksum verification are documented in the [release checklist](RELEASE_CHECKLIST.md).
