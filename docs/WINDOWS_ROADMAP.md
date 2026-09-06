# PaperReader Windows Roadmap

[中文版本](WINDOWS_ROADMAP_ZH.md)

PaperReader v0.3.1 includes the first Windows installer. This document tracks
the Windows implementation, available verification evidence, and remaining
acceptance work.

## 1. Published version

The [v0.3.1 Release](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases/tag/v0.3.1)
contains `PaperReader-0.3.1-x64-Setup.exe` for Windows 10/11 (x64), two macOS
DMGs, and a combined `SHA256SUMS.txt`.

The Windows package is an unsigned NSIS installer. It installs per user, allows
the installation directory to be selected, and uses manual upgrades: quit the
App and run the new Setup installer. The installer is configured to retain App
data on uninstall; upgrade and reinstall behavior still need the acceptance
checks below. Installation steps are in the [App guide](../app/README.md).

Windows arm64 and Linux packages are not available. Authenticode signing and
additional architectures remain future work. Verify the installer checksum;
do not globally disable Windows security controls. `app/run-windows.bat` is a
source-development helper, not a downloadable release package.

## 2. Implemented in v0.3.1

### Zotero and OneDrive

- [Zotero profile discovery](../app/zotero-profile.js) reads the Windows
  `%APPDATA%\Zotero\Zotero` layout and the configured linked attachment base.
- [OneDrive root validation](../app/onedrive-root.js) handles Windows roots;
  the App compares the configured attachment root with Zotero's setting.
- [Sync-state checking](../app/onedrive-cloud-verify.js) uses a Windows
  PowerShell file-attribute probe, with polling, cancellation, and a timeout.
  The current Windows condition checks the reparse-point attribute. It does
  not fetch the remote file or directly verify its contents, so confirmation
  across real OneDrive sync states remains an acceptance item.
- The shared PDF transaction validates and stages the PDF, waits for the
  platform check, verifies its hash, then creates or reconciles Zotero metadata.
  The four-task save queue and managed-item protections also apply on Windows.

### Reading and local data

- [Environment probing](../app/env-probe.js) includes Windows Python discovery
  and passes the verified interpreter path to reading tasks.
- The [Codex](../app/spawn-codex.js), [Claude](../app/spawn-claude.js), and
  [Trae](../app/spawn-trae.js) adapters contain Windows executable lookup and
  process handling. Each provider still needs independent Windows end-to-end
  validation with an available CLI and account.
- The bundled [paper-reading skill](../skills/paper-reading/SKILL.md) uses
  cross-platform Python tools for local file operations. Report browsing,
  search, caching, and Obsidian note-state tracking use shared App modules.
- Settings use Electron's platform-specific data directory. Zotero credentials
  use Electron `safeStorage`; the App has no plaintext credential fallback.

### Packaging and CI

- [Package configuration](../app/package.json) includes the Windows x64 NSIS
  target and `npm run dist:win`.
- [Build PaperReader](../.github/workflows/build-app.yml) has a native
  `windows-latest` job that installs locked dependencies, audits dependencies,
  runs Node and Python tests, builds the installer, audits packaged resources,
  and generates its checksum.
- [Release auditing](../app/release-audit.js) handles both platform layouts,
  scans for Windows and macOS personal paths, and checks packaged resources.
- The publish job depends on both platform builds. It verifies downloaded
  artifacts and the three-installer checksum manifest before creating the
  GitHub Release.

## 3. Verification evidence and limits

The v0.3.1 release assets and the build workflow provide evidence for packaging
and the automated checks above. Tests cover Windows profile paths, OneDrive
root validation and attribute responses, interpreter discovery, process
adapters, and release auditing. Relevant tests include:

- [Zotero profiles](../test/zotero-profile.test.js),
  [OneDrive roots](../test/onedrive-root.test.js), and
  [OneDrive state checking](../test/onedrive-cloud-verify.test.js);
- [environment probing](../test/env-probe.test.js) and
  [Codex](../test/spawn-codex.test.js), [Claude](../test/spawn-claude.test.js),
  and [Trae](../test/spawn-trae.test.js) process adapters; and
- [release audits](../test/release-audit.test.js).

These include fixture-based and injected-response tests. They do not establish
that a real OneDrive account has uploaded a file, that a provider completes a
read on every Windows configuration, or that Windows 10 and 11 installation
and upgrade behavior have all passed.

This repository does not yet contain a completed real-machine acceptance
record for the matrix below. Keep each item pending until its result is
recorded with the commit, installer checksum, Windows version, dependency
versions, and test date. Publishing the installer does not complete these
checks.

## 4. Remaining acceptance work

Run this matrix on clean Windows 10 and Windows 11 x64 VMs and at least one
representative real machine for each claimed configuration. Use
maintainer-controlled accounts and disposable Zotero, OneDrive, and Obsidian
data.

- [ ] Download the installer, verify its checksum, install to the default and a
  chosen directory, launch from shortcuts and the Start menu, quit, relaunch,
  and check idle behavior.
- [ ] Upgrade over the previous Windows build and verify settings, cache, vault
  selection, and usable encrypted Zotero credentials. Test reinstall,
  uninstall, and reinstall after uninstall; record which data remains and any
  downgrade restrictions.
- [ ] Test online and offline reports, search, navigation, external links, and
  the report sandbox. Unavailable platform operations must be clearly disabled
  or return an actionable error.
- [ ] Verify Zotero credentials and active profiles; test OneDrive root matching
  for personal and business accounts, multiple roots, drive-letter casing,
  junctions, reparse points, and symlinks without bypassing directory checks.
- [ ] Submit more than 10 PDF saves, confirm at most four run, and exercise
  duplicate reconciliation, cancellation, timeout, retry, managed-item removal,
  and interruption at each transaction stage.
- [ ] Test OneDrive online-only, locally available, uploading, conflicted,
  paused, signed-out, and offline states. Compare the Windows attribute probe
  with actual remote availability; ensure Zotero metadata is not reported as
  successfully saved before the PDF is available from the cloud.
- [ ] Open linked PDFs on a second supported device, including a macOS/Windows
  pair. Each device must use its corresponding local OneDrive attachment base.
- [ ] Test Obsidian vault discovery, existing-note actions, manual read-state
  changes, and rejection of broad or sensitive vault paths.
- [ ] Test each advertised AI provider independently: executable and login
  detection, one complete read, concurrent reads, cancellation, watchdog,
  timeout, quota/error display, output parsing, notes, PDFs, figures, code
  retrieval, and cache cleanup. Trae tests require an independently available
  CLI and account.
- [ ] Verify Codex permissions and protected runtime paths with the actual
  Windows Codex sandbox. Confirm PyMuPDF works through the selected interpreter
  and that tasks cannot read credentials or unrelated local files.
- [ ] Test non-ASCII usernames and paths, long paths, reserved Windows names,
  trailing dots/spaces, locked files, antivirus and indexing interference,
  sleep/wake, network loss, and restart during active work.
- [ ] Verify atomic replacement, rename, flush, cleanup, retry, and interrupted
  writes on NTFS and OneDrive folders. Cleanup must not escape its task's files.

## 5. Release requirements and future work

For each later release, complete the [release checklist](../RELEASE_CHECKLIST.md)
and update this record. Preserve the following requirements:

- Run locked dependency installation, dependency audits, Node/Python tests, and
  platform-specific integration tests on native Windows CI.
- Audit unpacked and packaged resources for secrets, personal paths, private
  data, required skills, licenses, notices, and the read-only site snapshot.
  Reject undeclared artifacts and obsolete update feeds.
- Generate checksums from the final installers, verify them after transfer, and
  stop publication if either platform's build, audit, or checksum check fails.
- Complete clean-VM and real-machine acceptance for every claimed configuration;
  document any failures or untested cases rather than marking them complete.
- Keep English and Chinese installation, usage, troubleshooting, security,
  release notes, checksum instructions, and compatibility statements aligned.

Future work includes evaluating Authenticode signing and Windows arm64 builds.
Linux would need its own platform work and acceptance plan. No release date is
set for these targets.
