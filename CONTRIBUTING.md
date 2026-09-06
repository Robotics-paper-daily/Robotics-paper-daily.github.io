# Contributing

[中文版本](CONTRIBUTING_ZH.md)

Robotics Daily Papers combines a generated public archive with the PaperReader
desktop app. Contributions should preserve the trust boundary: the website is
read-only, while credential access, filesystem writes, Zotero operations, and
AI CLI launches are controlled by the trusted application layer.

PaperReader v0.3.1 is available for macOS 12+ (Apple Silicon and Intel) and
Windows 10/11 (x64). The [GitHub Release](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1)
contains two DMGs, a Windows Setup installer, and `SHA256SUMS.txt`. See the
[Windows roadmap](docs/WINDOWS_ROADMAP.md) for implementation details and
outstanding platform validation.

## Before opening an issue

- Search existing issues and include the affected commit/version, operating
  system, architecture, minimal reproduction, expected result, and actual result.
- Remove Zotero keys, WebDAV passwords, AI-provider credentials, OneDrive data,
  private papers, vault notes, usernames, and personal filesystem paths from
  screenshots and logs.
- For a possible vulnerability, follow [SECURITY.md](SECURITY.md) and use a
  private report when available. Do not place exploit details or secrets in a
  public issue.
- Provider billing, quota, retention, and service availability are controlled
  by the provider unless PaperReader's integration causes the problem.

## Development setup

The release workflow uses Node.js 22. The publishing pipeline requires Python
3.10 or later. Build and validate the DMGs on macOS and the Setup installer on
Windows. The commands below use a POSIX shell; on Windows, activate the virtual
environment with `.venv\Scripts\Activate.ps1` in PowerShell.

```bash
git clone <repository-url>
cd Robotics-paper-daily.github.io

python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 -m pip install -r skills/paper-reading/requirements.txt

cd app
npm ci
npm test
npm start
```

Use fake accounts and disposable folders for integration tests. Never point a
test at another person's Zotero library, OneDrive folder, vault, or provider
account.

## Change boundaries

- **Publishing pipeline:** source is under `src/`; policy and topic settings are
  in `src/config.py`.
- **Generated reports:** edit the generator/template, then run
  `python3 src/rebuild_html.py --clean-stale`. Do not hand-edit individual files
  under `daily_html/` or `app/site/`.
- **Desktop app:** trusted orchestration belongs in `app/main.js` and focused
  modules; untrusted reports use the narrow bridge and must not receive secrets
  or arbitrary filesystem/network authority.
- **Zotero saves:** PDF download, local write, OneDrive confirmation, and final
  hash verification share a four-task FIFO queue. Duplicate requests with the
  same operation key share the queued or running task. Completion or failure
  releases the capacity for the next task. This is separate from AI read
  concurrency, which defaults to 10 and is configurable from 1-16.
- **Credentials:** Electron `safeStorage` is mandatory. Do not add plaintext
  fallback, browser credential bundles, WebDAV upload paths, or test fixtures
  that resemble real secrets.
- **Windows:** isolate platform behavior in focused adapters and add native
  Windows tests. Validate affected integrations with the packaged app as well
  as unit tests; record any remaining real-machine checks in the roadmap.

## Documentation

User-facing operating, security, release, and maintainer documentation is
paired in English and Chinese. When behavior changes, update both files in the
same change:

- `README.md` / `README_ZH.md`;
- `app/README.md` / `app/README_ZH.md`;
- `RELEASES_NOTES.md` / `RELEASES_NOTES_ZH.md`;
- `SECURITY.md` / `SECURITY_ZH.md`;
- `RELEASE_CHECKLIST.md` / `RELEASE_CHECKLIST_ZH.md`;
- `CONTRIBUTING.md` / `CONTRIBUTING_ZH.md`; and
- `docs/WINDOWS_ROADMAP.md` / `docs/WINDOWS_ROADMAP_ZH.md`.

Third-party legal and attribution text remains canonical in English in
`THIRD_PARTY_NOTICES.md`. Keep links, version status, platform claims, commands,
defaults, and limitations semantically aligned across languages.

## Required checks

Run the checks relevant to the change, and run all of them before proposing a
release:

```bash
# Repository Python tests
python3 -m unittest discover -s test -p 'test_*.py'

# App and documentation contract tests
cd app
npm test

# Refresh the packaged site snapshot and audit source/package inputs
npm run audit:release

# From the repository root
git diff --check
```

For publishing changes, rebuild the generated reports and inspect representative
daily pages plus search behavior. For App changes, also test a clean source
launch on each affected platform. Releases require the complete
[release checklist](RELEASE_CHECKLIST.md), clean-machine installation from the
DMGs and Windows Setup installer, and artifact verification.

## Pull request expectations

- Keep the change scoped and explain user-visible behavior and trust-boundary
  effects.
- Add or update tests for shared logic, regressions, IPC, paths, queues, and
  failure recovery.
- State which checks ran and which platform-specific checks could not run.
- Do not commit dependency directories, local build output, App support data,
  credentials, vault content, or unrelated generated churn.
- Do not change a candidate version to “published stable” until the official
  tag, Release, architecture-correct assets, and checksum manifest exist.
