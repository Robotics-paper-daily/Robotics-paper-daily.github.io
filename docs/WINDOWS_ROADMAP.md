# PaperReader Windows Roadmap

[中文版本](WINDOWS_ROADMAP_ZH.md)

This document records engineering work that would be required before PaperReader
can publish and support a Windows release. It is a planning document, not a
compatibility announcement or release commitment.

## 1. Current support boundary

- PaperReader v0.3.0 is the current macOS 12+ release target. It remains a
  candidate until its tag, GitHub Release, two DMGs, and checksum manifest
  actually exist.
- The v0.3.0 target has no Windows installer, no Windows GitHub Release asset,
  and no validated Windows end-to-end workflow.
- `app/run-windows.bat` is an experimental source launcher for contributors. It
  runs `npm ci` and `npm start`; it is not an installed product and is not
  evidence that the app is Windows-compatible.
- Windows, Linux, and source-only runs are outside the v0.3.0 desktop support
  matrix unless a later release explicitly says otherwise.
- No minimum Windows version, CPU architecture, installer format, preview
  version, or release date is promised yet.
- The current product and this roadmap use manual replacement upgrades only.
  Any different distribution policy would require a separate design and review.

## 2. Reusable foundation already present

The repository contains useful cross-platform groundwork, but each item still
requires Windows CI and real-machine validation:

- the Electron shell, sandboxed report rendering, search, cache, and Obsidian
  note-state logic are largely platform-neutral;
- Obsidian discovery includes `%APPDATA%` and `%USERPROFILE%` paths;
- the Codex, Claude, and Trae adapters include Windows native executable lookup,
  `shell: false`, hidden child processes, and `taskkill`-based cancellation;
- settings use Electron's platform-specific `userData` directory, and the Zotero
  credential store is structured around Electron `safeStorage`;
- the Zotero Web API metadata/reconciliation layer is not inherently tied to
  macOS;
- the bundled Python utilities already force UTF-8 output in several Windows
  console paths and apply an initial set of Windows filename restrictions; and
- the PDF writer already performs validation, bounded downloads, hashing, and
  staged file commits that can serve as the basis for a Windows implementation.

These are implementation starting points, not supported Windows features.

## 3. Core blockers

### 3.1 Zotero and OneDrive integration

- `zotero-profile.js` currently discovers Zotero only under the macOS
  `~/Library/Application Support/Zotero` layout. Windows profile discovery must
  use documented Windows locations, parse the active profile safely, and remain
  testable without reading a developer's real profile.
- `main.js` currently accepts linked-attachment roots only inside a macOS
  OneDrive File Provider domain.
- `onedrive-cloud-verify.js` relies on `/usr/bin/fileproviderctl` and deliberately
  rejects non-macOS platforms. Windows needs a trustworthy, bounded, fail-closed
  cloud-state adapter; local file existence alone is not proof of completed
  OneDrive upload.
- Root comparison must account for drive letters, case-insensitive paths,
  junctions, reparse points, symlinks, and multiple personal or business
  OneDrive roots without allowing directory-boundary bypasses.
- The full transaction order must remain: validate configuration, stage and
  verify the PDF, confirm durable cloud state, create/reconcile Zotero metadata,
  and preserve the documented retry and rollback behavior.

### 3.2 Python and paper-reading runtime

- Environment probing currently assumes a `python3` command. Windows discovery
  must safely resolve and persist an exact `python.exe` (or a verified Python
  launcher result) that can import the supported PyMuPDF version.
- `skills/paper-reading/SKILL.md` currently contains POSIX shell syntax such as
  `test`, `$VAR`, and `cp`. The workflow must become shell-neutral or use trusted
  app-owned orchestration instead of asking a provider to translate commands.
- Codex, Claude, and Trae executable detection, login checks, argument handling,
  streaming, cancellation, timeout, and process-tree cleanup must be exercised
  on Windows, not inferred from macOS unit tests.
- The Codex permission profile and protected runtime paths must be verified with
  Windows path syntax and the actual Windows Codex sandbox implementation before
  Codex can be declared supported.

### 3.3 Windows filesystem behavior

- Note, attachment, cache, and temporary names must reject reserved device names,
  invalid characters, trailing dots or spaces, and unsafe alternate path forms.
- Path-length behavior must be defined and tested for nested Obsidian notes,
  attachments, downloaded source files, and packaged resources.
- Atomic replace, rename, file locking, flush, cleanup, retry, and interrupted
  write behavior must be tested on NTFS and OneDrive-synchronized directories.
- Unicode, non-ASCII account names, network-unavailable states, and files held
  open by Zotero, OneDrive, antivirus, or indexing software need explicit tests.

### 3.4 Packaging and application lifecycle

- Add an explicit electron-builder `win` configuration, Windows icon resources,
  artifact naming, and a `dist:win` script only after the supported Windows and
  CPU matrix is selected.
- Select and test the installer format and scope, shortcut behavior, start-menu
  integration, install location, repair/reinstall behavior, and clean uninstall.
- Define manual upgrade behavior and verify that replacing or upgrading the app
  preserves intended `%APPDATA%` settings, cache, and encrypted credentials.
  Document separately whether uninstall retains or removes this data.
- Decide and document the Authenticode/code-signing and SmartScreen policy before
  public distribution. Checksums remain required whether or not artifacts are
  signed, and documentation must never recommend globally disabling Windows
  security controls.
- Platform capability checks must hide or clearly disable unavailable workflows;
  a Windows user must not reach macOS-only Zotero setup and receive a generic
  failure.

## 4. Phased implementation

### Phase 0: Freeze the contract

1. Select the candidate Windows version and CPU matrix based on supported
   Electron, Zotero, OneDrive, Obsidian, Python, and provider-CLI combinations.
2. Define the initial feature contract and decide whether every macOS feature is
   required for the first Windows release.
3. Add platform capability interfaces and keep unsupported operations fail-closed.
4. Convert current macOS-only assumptions into explicit platform tests before
   changing behavior.

### Phase 1: Platform storage adapters

1. Implement and unit-test Windows Zotero profile discovery.
2. Implement Windows OneDrive root validation and cloud-state confirmation behind
   the same narrow interface used by macOS.
3. Validate canonical path equality and PDF transaction behavior on Windows.
4. Add failure-injection tests for offline sync, conflicts, locked files,
   cancellation, timeout, and restart.

### Phase 2: Reading runtime

1. Add safe Windows Python discovery and persist the verified interpreter path.
2. Replace POSIX-only skill commands with platform-neutral, app-owned operations
   or documented Windows equivalents selected by code.
3. Validate each provider adapter independently on Windows.
4. Run concurrent reads, cancellation, watchdog, note creation, figure extraction,
   code retrieval, and cleanup against a disposable vault.

### Phase 3: Installer and lifecycle

1. Add Windows packaging configuration, icon assets, and reproducible artifact
   names without changing the manual-update product policy.
2. Test clean install, first launch, reinstall, manual upgrade, downgrade refusal
   if applicable, uninstall, and reinstall after uninstall.
3. Verify that intended local data is retained across upgrades and that secrets
   are not copied into the installer or logs.
4. Finalize signing, checksum, user-facing download, and first-launch guidance.

### Phase 4: CI, security, and release candidate

1. Add native `windows-latest` CI for every candidate release architecture.
2. Run source tests, packaged-app audits, installer validation, and smoke tests on
   Windows rather than cross-compiling and assuming compatibility.
3. Publish a clearly labeled prerelease only after all automated gates pass.
4. Complete clean-VM and real-machine acceptance testing before declaring a
   stable Windows release.

## 5. CI and security gates

A Windows release candidate must satisfy all of the following:

- locked dependency installation, dependency audit, Node tests, and Python tests
  pass on native Windows CI;
- provider, path, process, credential, PDF-store, Zotero, and OneDrive adapters
  have Windows-specific unit and integration coverage;
- packaged resources contain the required skill, license, notices, and read-only
  site snapshot, with no config, credentials, tokens, private vault data, or
  developer-specific paths;
- `app/release-audit.js` is refactored from its current assumption of exactly two
  packaged `app.asar` files into an explicit per-platform/per-architecture
  artifact manifest;
- `test/release-audit.test.js` no longer asserts that `dist:win` is absent, while
  still rejecting undeclared artifacts and stale update feeds;
- source and package scanning detects Windows personal paths such as
  `C:\\Users\\<name>\\...`, in addition to the existing macOS user-path check;
- installer contents and unpacked `app.asar` pass the same secret, privacy, and
  allowlist audits as the macOS packages;
- CI produces checksums from the exact release artifacts and verifies them after
  artifact transfer; and
- release jobs cannot publish partial or mixed-version assets when any platform
  build, audit, or checksum verification fails.

## 6. Installation and real-machine acceptance gates

For every operating-system version and architecture eventually listed as
supported, test on a clean VM and at least one representative real machine:

- installer download, checksum verification, first launch, shortcut/start-menu
  launch, normal quit, relaunch, and crash-free idle behavior;
- manual upgrade from the previous supported Windows build with settings, cache,
  vault selection, and usable encrypted Zotero credentials preserved as intended;
- uninstall and reinstall behavior, including an explicit check of which local
  data remains;
- online and offline report loading, search, navigation, sandbox boundaries, and
  external-link routing;
- Zotero key verification, active-profile discovery, OneDrive root matching,
  concurrent PDF adds, duplicate reconciliation, cancellation, retry, removal,
  and cross-device linked-attachment access;
- OneDrive online-only, locally available, syncing, conflicted, paused, signed-out,
  and offline states, with no Zotero metadata success before cloud confirmation;
- Obsidian vault discovery, already-read state, note opening, manual read-state
  changes, and protection against broad or sensitive vault paths;
- every provider advertised as supported, including login detection, one complete
  read, concurrent reads, cancellation, timeout, quota/error display, output
  parsing, and cache cleanup; and
- non-ASCII Windows usernames and paths, long paths, locked files, antivirus
  scanning, sleep/wake, network interruption, and application restart during
  active work.

Tests that mutate Zotero, OneDrive, Obsidian, or provider accounts must use
maintainer-controlled fixtures and disposable data, never a contributor's
personal library or vault.

## 7. Stable release gate

Windows may be marked supported only when all of these conditions are true:

1. the exact supported Windows versions, CPU architectures, features, installer
   format, signing state, and manual-upgrade policy are documented;
2. native CI, packaged audits, clean-VM tests, and real-machine end-to-end tests
   pass for every claimed configuration;
3. English and Chinese installation, usage, troubleshooting, privacy, security,
   release-note, and checksum instructions are synchronized;
4. the GitHub Release contains only declared, version-matched artifacts and a
   verified checksum manifest; and
5. maintainers have completed an updated release checklist that covers both the
   existing macOS channel and the new Windows channel.

Until then, repository text and issue responses must say **Windows planned, not
supported or released**, and must not use “compatible,” “preview available,” or a
release date without corresponding tested artifacts.
