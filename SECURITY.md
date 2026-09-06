# Security policy

[中文版本](SECURITY_ZH.md)

## Supported versions and platforms

Security fixes are provided for the current `main` branch and for the latest
stable PaperReader desktop release that actually exists on the official
[GitHub Releases](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases)
page. If that page has no PaperReader desktop release, only the current `main`
branch is supported.

| Software or platform | Status |
|---|---|
| Current `main` branch | Supported |
| Latest PaperReader macOS (12+) stable release that actually exists on Releases | Supported |
| Latest PaperReader Windows 10/11 (`x64`) stable release that actually exists on Releases | Supported |
| v0.3.1 target in this source tree | Candidate until its tag, Release, three installers, and the merged `SHA256SUMS.txt` actually exist |
| Retired v0.2 browser writer | Unsupported; do not use for a new installation |
| Windows `arm64` | Unsupported; no build is produced |
| Linux | Unsupported; there is no official installer or release commitment |

The retired v0.2 WebDAV upload and encrypted website credential bundle must not
be used for a new installation. Cross-platform helpers or launch scripts in the
repository do not place a platform in the support matrix.

## Report a vulnerability

Use the repository's **Security → Report a vulnerability** form when it is
available. Include the affected version, platform, minimal reproduction, and
impact, but do not include a real API key, password, private paper, vault note,
or unredacted App-support directory. If private reporting is unavailable, open
a minimal public issue asking the maintainers for a private channel and omit
all exploit details and secrets until one is provided.

Please do not test against another person's Zotero, OneDrive, Obsidian vault,
AI-provider account, or GitHub installation. We will acknowledge a usable
report and coordinate disclosure after a fix is available.

## Scope

In scope:

- credential storage, permission checks, and migration in supported code or a
  supported desktop release;
- report iframe sandboxing, the App bridge, IPC allowlists, and user-gesture
  validation;
- data flows PaperReader initiates through Zotero, OneDrive, Obsidian, and local
  AI CLIs;
- path validation, file writes, cache cleanup, package boundaries, and release
  artifact integrity; and
- handling of untrusted papers, PDFs, HTML, repositories, and provider output.

Out of scope:

- the retired v0.2 browser mutation path;
- unreleased and unsupported platform builds (Linux, Windows `arm64`);
- vulnerabilities wholly within Zotero, OneDrive, Obsidian, GitHub, arXiv, or
  an AI provider unless PaperReader's integration or boundary handling causes
  the issue;
- testing against accounts, devices, libraries, vaults, or deployments the
  reporter does not own; and
- provider billing, quotas, retention policies, or service availability.

## Data and trust boundaries

The local paths below use the macOS layout; on Windows the same PaperReader
files live under `%APPDATA%\PaperReader\` and the same boundaries apply.

| Data/action | Destination | Boundary |
|---|---|---|
| Public reports | Project GitHub Pages / local cache | Read-only report content is untrusted and sandboxed |
| Zotero API key and user ID | `~/Library/Application Support/PaperReader/zotero-credentials.secure.json` | Encrypted with Electron `safeStorage` (Keychain-backed on macOS, DPAPI-backed on Windows); plaintext fallback is refused |
| Non-secret App settings | `~/Library/Application Support/PaperReader/config.json` | Local file; may reveal private filesystem paths |
| Report cache | `~/Library/Application Support/PaperReader/site-cache/` | Public report data cached locally |
| Reading scratch | `~/Library/Application Support/PaperReader/paper-cache/` | App-owned, outside the vault; exposed to a provider as `$PAPERREADER_CACHE_DIR` |
| Zotero metadata | Zotero Web API and Zotero Sync | Personal-library read/write key; never sent into report HTML |
| Linked PDF bytes | User-selected OneDrive folder | OneDrive sync, confirmed fail-closed by macOS File Provider or the Windows NTFS cloud-files placeholder state; separate from Zotero metadata sync |
| Finished paper notes | User-selected Obsidian vault | May include paper text, figures, source snippets, and private annotations |
| AI reading request | Selected OpenAI Codex CLI (`codex`), Claude Code, or TraeCode provider | Provider CLI may transmit the paper, prompt, context, and diagnostics under provider terms |

The public website is read-only. It does not receive Zotero credentials, write
OneDrive files, start a local AI CLI, or modify a vault.

## Local provider permissions and network use

PaperReader resolves the bundled `paper-reading/SKILL.md` to an absolute path
and passes that exact path to the selected AI CLI. The Codex adapter runs
`codex exec --json --ephemeral` with a named permission profile based on
`:workspace`. Filesystem reads are denied by default; only Codex's minimal
runtime, the bundled skill, the probed Python/PyMuPDF runtime, selected vault
content outside `.obsidian`, and the App cache are exposed. That vault content
and cache are writable, and network access is enabled. System temporary
directories are denied and redirected into App cache.

Before reporting Codex ready, PaperReader forces a real local parse of every
security-sensitive override using a random, deliberately missing output-schema
path. It accepts only the exact missing-file failure; this creates no schema
file and does not invoke a model. The adapter ignores user config and
exec-policy rules for the job, marks the vault untrusted so project-scoped
`.codex` config/hooks/rules are skipped, and disables global/vault `AGENTS.md`
discovery, plugins, apps, hooks, skill discovery, login shells, and shell
snapshots. It exposes only a core shell environment plus exact
`$PAPERREADER_CACHE_DIR` and `$PAPERREADER_PYTHON` values. Sandboxed commands
cannot read `$CODEX_HOME`, SSH material, PaperReader settings, the vault's
`.obsidian` configuration/plugins, or unrelated home-directory files; Codex
itself still authenticates through `codex login`. These beta permission
profiles are defense in depth rather than a complete OS security boundary.
Claude and Trae run in their provider-specific non-interactive bypass modes.
Use only a trusted vault, do not point it at a broad personal folder, and review
the provider's privacy, retention, and billing terms.

PaperReader rejects a vault that is the filesystem root, the user home, an
ancestor containing that home, or a common broad top-level home folder such as
`Documents`, `Downloads`, `Library`, `.config`, `.local`, `.codex`, or `.ssh`.
A dedicated nested folder remains valid. The Codex adapter additionally rejects
any vault overlap with PaperReader user data/cache, `$CODEX_HOME`, or the user's
SSH directory so a writable vault grant cannot swallow those protected roots.

Papers, PDFs, project pages, repositories, citations, and metadata may contain
prompt-injection text. The bundled skill explicitly treats all of them as data,
rejects embedded instructions, and forbids reading credentials or unrelated local
files. This is a behavioral guard in addition to the sandbox, not a replacement
for OS isolation; stop a job if its requested command or output looks unrelated
to paper analysis.

[OpenAI Codex CLI (`codex`)](https://developers.openai.com/codex/cli/) and
Claude Code are independently installed public CLIs. Codex uses its own
ChatGPT/API authentication; Claude uses its own subscription/OAuth session.
TraeCode support applies only to users who have already been provided a
supported CLI and account; this project does not distribute or provision it.
PaperReader does not collect or save credentials for any AI provider.

PaperReader contains no built-in analytics or telemetry. Feature-required
network traffic still goes to the public report site, arXiv, Zotero, OneDrive
(macOS File Provider or the Windows OneDrive sync engine), and the selected AI
provider. External services
may apply their own logging and telemetry policies.

## Credential handling and migration

- Never put Zotero keys, WebDAV passwords, AI credentials, OneDrive tokens, or
  real vault paths in source, screenshots, logs, test fixtures, issues, release
  notes, or release artifacts.
- A Zotero key must belong to the same personal-library account used by Zotero
  desktop and must be limited to the required library read/write permissions.
- Anyone who used v0.2 must revoke and rotate every Zotero key and WebDAV
  password that entered the old browser bundle. Deleting a file from the latest
  revision does not remove it from Git history or revoke the credential.
- Clearing the key in PaperReader removes the local encrypted envelope. Deleting
  the App alone does not: local support data is intentionally retained for
  upgrades.
- Do not publish the App support directory. Even encrypted files and non-secret
  configuration can disclose usernames, paths, providers, or library structure.

## Release integrity

This source tree targets v0.3.1, but it remains a candidate until the matching
tag, GitHub Release, three installers, and the merged `SHA256SUMS.txt` actually
exist. Documentation
must not call it a published stable release before then.

The candidate v0.3.1 installers are unsigned: the DMGs are unnotarized and the
Windows setup has no Authenticode signature. After an official
release exists, download the platform-correct installer and `SHA256SUMS.txt`
from that same Release, use the matching checksum command in
[`README.md`](README.md),
and require the check to pass. A SHA-256 match detects a corrupt download;
it does not replace Apple signing/notarization or Windows Authenticode signing
and cannot prove provenance if
the release account or channel is compromised.

Each newly downloaded App bundle may require Finder's Control-click/right-click
**Open** exception on first launch. Never advise users to disable Gatekeeper
globally.

On Windows, first run of the unsigned installer may trigger Microsoft Defender
SmartScreen. After the SHA-256 has been verified, **More info** → **Run
anyway** applies to that one file only. Never advise users to disable
SmartScreen, Defender, or other Windows security controls globally.

Maintainers must follow the [English release checklist](RELEASE_CHECKLIST.md) or
the [Chinese checklist](RELEASE_CHECKLIST_ZH.md), including secret scans,
artifact audits, tests, checksum verification, and stable-channel publication.
