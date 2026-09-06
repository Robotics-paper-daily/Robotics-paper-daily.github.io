# PaperReader stable release checklist

[中文版本](RELEASE_CHECKLIST_ZH.md)

Use this checklist for each release. The current packages cover macOS 12+
(Apple Silicon and Intel) and Windows 10/11 (x64). v0.3.1 has been published;
this reusable checklist is not its completed acceptance record.

For the next release, record the tested commit, installer checksums, operating
systems, and results. Complete the pre-release checks before pushing the tag,
which triggers publication, then complete the post-publish checks below.

## 1. Scope and version

- [ ] Release version is identical in the intended tag (`vX.Y.Z`), App package,
  lockfile, window/about UI, documentation, asset names, and release notes.
- [ ] Release notes describe the version's actual publication state and list
  known limitations and outstanding validation.
- [ ] Platform and architecture claims match the tested installers. The current
  packages cover macOS 12+ on Apple Silicon and Intel, and Windows 10/11 on x64;
  Windows arm64 and Linux have no released packages.
- [ ] Record the Windows real-machine acceptance results. Keep untested cases
  and future work, including signing and Windows arm64, in the roadmap.
- [ ] `app/run-windows.bat` is treated only as a source development helper, not
  a release artifact; the supported Windows entry point is the Setup installer.
- [ ] No unrelated local build, cache, credential, vault, or user file is in the
  commit.
- [ ] The website is documented and rendered as read-only; local Zotero and AI
  actions are App-only.
- [ ] Each English/Chinese pair exists, cross-links at the top, and agrees on
  behavior, version, platform, and release state: `README.md` / `README_ZH.md`,
  `app/README.md` / `app/README_ZH.md`, `RELEASES_NOTES.md` /
  `RELEASES_NOTES_ZH.md`, `SECURITY.md` / `SECURITY_ZH.md`, and
  `RELEASE_CHECKLIST.md` / `RELEASE_CHECKLIST_ZH.md`, `CONTRIBUTING.md` /
  `CONTRIBUTING_ZH.md`, and `docs/WINDOWS_ROADMAP.md` /
  `docs/WINDOWS_ROADMAP_ZH.md`.
- [ ] Third-party notices agree with those documents. If legal/license text is
  intentionally canonical in English only, Chinese navigation says so instead
  of implying that a Chinese body exists.

## 2. Privacy and source audit

- [ ] Review `git status --short`, `git diff --stat`, and the full staged diff.
- [ ] Run the repository's release/privacy audit and a tracked-file secret scan.
  Treat every match as unresolved until manually classified.
- [ ] Confirm there are no real Zotero keys/user IDs, WebDAV credentials, site
  passwords, OneDrive tokens, AI-provider credentials, personal home paths,
  vault content, private paper text, or production account identifiers.
- [ ] Confirm generated App/site snapshots do not contain retired v0.2 browser
  writer code or credential bundles.
- [ ] Confirm test fixtures use unmistakably fake values and no real external
  accounts.
- [ ] Remind v0.2 users to revoke and rotate historical Zotero/WebDAV credentials.

## 3. Functional gates

- [ ] Install locked dependencies with `npm ci` in `app/`.
- [ ] Run the complete App test suite with `npm test`.
- [ ] Run relevant Python tests with `python3` in a clean environment.
- [ ] Verify `python3 -c 'import fitz'` with the supported PyMuPDF range from
  `skills/paper-reading/requirements.txt`.
- [ ] Smoke-test settings persistence across App restart and in-place upgrade.
- [ ] On a fresh configuration, confirm provider discovery prefers OpenAI Codex
  CLI (`codex`), then Claude Code, then TraeCode; confirm an explicit provider
  selection is never replaced and the no-CLI fallback remains Codex.
- [ ] Verify the Zotero PDF/OneDrive write stage has a fixed maximum concurrency
  of **4**: a burst of more than 10 papers is fully accepted, at most four run,
  the rest remain FIFO, duplicate queued/running operation keys are coalesced,
  and every success or failure releases its slot. This limit is independent of
  configurable AI reading concurrency.
- [ ] Smoke-test one-click Add, full-library presence detection, and safe retry
  after a simulated late Zotero failure.
- [ ] Confirm new Zotero parents carry `paperreader-managed-v1`; repair/Remove
  fails closed unless that tag and `Daily Paper` tree membership both hold.
- [ ] Confirm Remove leaves the OneDrive PDF untouched.
- [ ] Confirm card/search Add uses report date and manual arXiv Add uses the
  first-published date.
- [ ] Confirm Zotero metadata appears through Zotero Sync and the PDF opens from
  a second supported device. Include a macOS/Windows pair, with each device's
  linked attachment base pointing to the corresponding OneDrive folder.
- [ ] Smoke-test Codex after authenticating through the
  CLI itself. Confirm PaperReader neither requests nor stores the ChatGPT/API
  credential, an empty `codexModel` uses the isolated task's Codex default, and
  an explicit model override is passed only when set.
- [ ] Confirm the Codex launch uses `codex exec --json --ephemeral`, a named
  `:workspace`-based permission profile, and default-deny reads. Allow only the
  required runtime, bundled skill, verified Python, vault content outside
  `.obsidian`, and App cache. The vault content and App cache are writable;
  network access is enabled, system temp is denied and redirected to App cache,
  and tasks require no interactive approvals.
- [ ] Confirm Codex tasks ignore user config/rules and mark the vault untrusted
  to skip project `.codex` layers. Disable global/vault `AGENTS.md` discovery,
  plugins, apps, hooks, skill discovery, login shells, and shell snapshots.
  Deny sandboxed commands access to `$CODEX_HOME`, SSH material, PaperReader
  settings, the vault's `.obsidian` configuration/plugins, and unrelated home
  files. Retain Codex's own `codex login` authentication and filter environment
  values passed to generated shells.
- [ ] Confirm the Codex readiness probe performs a real local parse of all
  security-sensitive overrides with a random nonexistent output-schema path,
  accepts only that exact missing-file error, creates no file, and never invokes
  a model. An unknown config field must fail readiness.
- [ ] Confirm vault validation rejects the filesystem root, user home and its
  ancestors, and common broad top-level home folders. For Codex, also reject
  overlap with PaperReader user data/cache, `$CODEX_HOME`, or SSH. Accept a
  dedicated nested vault.
- [ ] Confirm the bundled skill treats paper/PDF/HTML/repository text as
  untrusted data and forbids credential or unrelated local-file reads.
- [ ] Smoke-test Claude Code. Test TraeCode only with an independently provided,
  supported CLI/account; do not claim a public Trae install path.
- [ ] For Codex, Claude, and Trae, confirm the resolved absolute path to the
  bundled `paper-reading/SKILL.md` is passed to the CLI and the job writes only
  the intended vault/cache outputs. Confirm the exact probed Python executable
  is passed as `$PAPERREADER_PYTHON` and can import PyMuPDF inside the Codex
  permission profile.
- [ ] Confirm generated notes, PDFs, figures, code links, existing-note action,
  and checked/unchecked read-state semantics.
- [ ] Confirm `$PAPERREADER_CACHE_DIR` is absolute, App-owned, outside the vault,
  and cleanup cannot traverse symlinks or delete another job's files.
- [ ] Confirm environment probing rejects a filesystem-root or user-home vault
  before any reading job can start.

## 4. Build and artifact audit

### macOS

- [ ] Build unsigned `arm64` and `x64` DMGs on the supported macOS runner (CI
  `build-macos` job or `npm run dist:mac`).
- [ ] Install each DMG on a clean matching Mac or clean VM/user profile.
- [ ] Verify first launch using the [App guide](app/README.md): after an initial
  attempt, use System Settings > Privacy & Security > Open Anyway if macOS
  blocks the verified App. Do not disable Gatekeeper globally.
- [ ] Confirm packaged resources contain the `paper-reading` skill, scripts,
  references, requirement declaration, icons, and minimal read-only site snapshot.
- [ ] Run the release artifact audit against the unpacked App and both DMGs.

### Windows

- [ ] Build the unsigned Windows x64 NSIS installer through the CI
  `windows-latest` job or locally with `npm run dist:win` on Windows x64.
- [ ] Verify the `PaperReader-<version>-x64-Setup.exe` line of the merged
  `SHA256SUMS.txt` with `Get-FileHash` (PowerShell) or `sha256sum -c`
  (Git Bash) against the final artifact.
- [ ] Fresh-install smoke test on clean Windows 10 and Windows 11 (x64):
  SmartScreen **More info** → **Run anyway** on the verified file only,
  per-user install with a choosable directory, first launch, one Add to
  Zotero with the local sync-state check and manual confirmation of cloud
  availability, and one 「帮我读」 read.
- [ ] Manual-upgrade smoke test: run the new Setup exe over the previous
  install and confirm settings, caches, and encrypted credentials under
  `%APPDATA%\PaperReader` remain available.
- [ ] Run the release artifact audit against the unpacked Windows app and the
  Setup exe.

### Release assets

- [ ] Confirm the merged `SHA256SUMS.txt` is generated from the final,
  immutable installers and verifies against all three.
- [ ] Confirm the uploaded assets contain exactly the two architecture-correct
  DMGs, the Windows x64 Setup exe, and the merged `SHA256SUMS.txt`, with no
  duplicate or obsolete package. GitHub-generated source archives may appear
  separately.
- [ ] Confirm no `.msi`, portable archive, incremental delivery manifest, extra
  `.yml` metadata or feed file, ZIP patch asset, or `run-windows.bat` is
  uploaded as a release asset.

## 5. Publish and post-publish

- [ ] Confirm the release workflow creates a stable GitHub release and does not
  set an early-access flag.
- [ ] Create and push the annotated release tag (optionally Git-signed) only
  after the release commit is reviewed and authorized.
- [ ] Verify the GitHub release title, notes, platform/architecture labels, the
  unsigned (unnotarized DMG / no-Authenticode setup) warnings, checksum
  instructions, manual-upgrade instructions, and links.
- [ ] Confirm the tag, GitHub Release, three installers, and the merged
  `SHA256SUMS.txt` are publicly available, then update the documentation's
  publication status and download links.
- [ ] Download all published assets again and independently verify checksums.
- [ ] Test the public release page and one clean install from the published DMG
  and one from the published Setup exe.
- [ ] Replace an older installed build with the new DMG (macOS) or the new
  Setup exe (Windows) and confirm App settings,
  cache, and encrypted credentials remain available.
- [ ] Verify the public website still exposes only read-only functionality.
- [ ] Record any discovered regression in the release notes and security channel;
  rotate a credential immediately if the audit finds a real secret.
- [ ] Update the [Windows roadmap](docs/WINDOWS_ROADMAP.md) with acceptance
  evidence, unresolved failures, and future work. Adjust compatibility claims
  or release notes when testing reveals a limitation.
