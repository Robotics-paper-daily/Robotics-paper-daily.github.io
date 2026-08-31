# PaperReader v0.3.0 for macOS

[中文发布说明](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/v0.3.0/RELEASES_NOTES_ZH.md)

PaperReader v0.3.0 moves Zotero saves and local AI-assisted reading into the
desktop app. The public GitHub Pages site remains a read-only paper archive.

> **Security action for v0.2 users:** revoke and recreate every Zotero API key
> and WebDAV password that was ever placed in the retired encrypted website
> bundle. v0.3.0 does not use that bundle, but removing it from the current tree
> cannot revoke credentials preserved in earlier Git history.

## Release assets

The app release contains two installers for macOS 12 or newer and one checksum
manifest:

- `PaperReader-0.3.0-arm64.dmg` for Apple Silicon;
- `PaperReader-0.3.0-x64.dmg` for Intel Mac; and
- `SHA256SUMS.txt` covering both DMGs.

Download the matching DMG and `SHA256SUMS.txt` attached to this Release. If you
are reading this file in the repository, use the official
[Releases page](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/releases).

Verify the downloaded installer before opening it:

```bash
cd ~/Downloads
# Apple Silicon:
grep 'PaperReader-0.3.0-arm64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
# Intel:
grep 'PaperReader-0.3.0-x64.dmg$' SHA256SUMS.txt | shasum -a 256 -c -
```

Run only the command for the architecture you downloaded. It must report `OK`.

The DMGs are not signed with an Apple Developer ID and are not notarized. A
checksum detects corruption, but it does not replace Apple signing or prove
provenance if the release channel itself is compromised.

v0.3.0 is macOS-only. Windows is planned but is not included or supported in
this release; `app/run-windows.bat` is an experimental source-development
launcher, not a product or installer. Linux is unsupported. See the
[Windows roadmap](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/v0.3.0/docs/WINDOWS_ROADMAP.md).

## Highlights

### App-local Zotero workflow

- Users connect their own 24-character Zotero API key. PaperReader verifies
  personal-library read/write access, derives the numeric user ID, and encrypts
  both locally with Electron `safeStorage`; plaintext fallback is refused.
- A paginated read-only scan recognizes existing arXiv items across the whole
  personal library. Presence-only matches are not duplicated, modified, or
  exposed as removable items.
- Newly created parent items carry the visible Zotero tag
  `paperreader-managed-v1`. Repair and Remove require that tag and current
  membership in the `Daily Paper` collection tree.
- PDFs are validated and written into Zotero's OneDrive-backed Linked
  Attachment Base Directory. PaperReader checks the active Zotero profile,
  confirms the OneDrive cloud state, re-hashes the committed file, and then
  creates `linked_file` metadata.
- PDF download, local placement, OneDrive confirmation, and final verification
  use a fixed four-slot FIFO queue. Duplicate queued or running operations are
  coalesced; larger bursts wait for a slot. Zotero API calls before and after
  this stage retain separate timeouts and reconciliation.
- Retries reconcile lost API responses instead of blindly creating duplicate
  items. Remove deletes eligible managed Zotero metadata but intentionally
  leaves the validated PDF in OneDrive.

### Local reading and Obsidian notes

- **「帮我读」** sends a paper to a locally installed and authenticated Codex or
  Claude CLI. Trae remains available only to users who independently have a
  supported `trae-cli` or `trae-agent` build and account.
- The bundled `paper-reading` skill writes structured results to
  `<vault>/<date>/<title>/`. Existing notes can be opened from the paper card;
  checking the note's final `- [ ] ✅ 已读` item changes the card to **✓ 已读**.
- AI reading concurrency defaults to `10` and can be configured from `1` to
  `16`. It is independent of the fixed four-slot Zotero PDF queue.
- Provider discovery, vault scans, cache maintenance, and historical search
  indexing run as bounded background work to reduce main-process blocking.
- Paper extraction requires `python3` and PyMuPDF (`fitz`). The supported source
  dependency range is recorded in `skills/paper-reading/requirements.txt`.

### Product and security boundary

- Add to Zotero and **「帮我读」** are available only in PaperReader. The public
  site continues to provide browsing, search, daily reports, and outbound links.
- Report content runs in a restricted sandbox and receives only typed app
  actions. Zotero credentials and arbitrary filesystem or network access are
  not exposed to report pages.
- PaperReader has no built-in analytics or telemetry. Feature-required traffic
  still reaches the public report site, arXiv, Zotero, OneDrive/macOS File
  Provider, and the selected AI provider.
- Codex, Claude, and Trae are external services. Their CLIs may transmit the
  paper, prompt, and generated context under their own terms. PaperReader does
  not collect or save their login credentials.

## Install and configure

1. Download the correct DMG, open it, and copy PaperReader to Applications.
2. For the first launch, Control-click or right-click PaperReader in Finder,
   choose **Open**, and confirm **Open**. Do not disable Gatekeeper globally.
3. Install and run Zotero and OneDrive. Sign Zotero into the same personal
   library account as the API key, enable Zotero Sync, and complete one sync.
4. Set Zotero's Linked Attachment Base Directory to a folder inside OneDrive.
5. Create a 24-character Zotero API key with personal-library read/write access,
   paste it into PaperReader Settings, and save it after verification.
6. Confirm the detected Zotero profile and OneDrive attachment directory.
7. To use **「帮我读」**, select a dedicated Obsidian vault and a logged-in Codex
   or Claude CLI, or an independently provisioned Trae CLI. Do not select a
   filesystem root, home directory, broad top-level home folder, or a path that
   overlaps PaperReader data, `$CODEX_HOME`, or SSH files.
8. Confirm that login-shell `python3 -c 'import fitz'` succeeds. A source checkout
   can install the supported range from `skills/paper-reading/requirements.txt`.

See the [PaperReader guide](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/v0.3.0/app/README.md)
for the complete walkthrough and troubleshooting.

## Upgrading from an earlier build

- Quit PaperReader, verify the new DMG, and replace the app in `/Applications`.
  Do not delete `~/Library/Application Support/PaperReader/`; settings, site
  cache, and encrypted Zotero credentials are preserved when the app bundle is
  replaced.
- Browser-personal-mode credentials are not imported. Configure a new app-local
  Zotero key and rotate every key or WebDAV password previously used by v0.2.
- Existing linked attachments remain valid while Zotero's Linked Attachment
  Base Directory resolves to the same OneDrive folder. Reconfirm the directory
  after moving OneDrive storage or switching Zotero profiles.

## Known limitations

- Only full DMGs are distributed. App replacement is manual, and there are no
  incremental-distribution assets.
- The DMGs are unsigned and unnotarized, so first launch requires Finder's
  explicit **Open** action.
- Windows and Linux have no supported installers or validated end-to-end
  workflows in v0.3.0.
- OneDrive must be installed, signed in, and healthy when a PDF is added. Zotero
  must expose a readable active profile and configured Linked Attachment Base
  Directory.
- AI-provider availability and quota depend on the user's local provider
  account.
- A late Zotero API failure can leave a validated PDF in OneDrive. Retrying the
  same paper is safe; removing a managed Zotero item does not remove that file.

For the complete security and privacy model, read the
[Security Policy](https://github.com/Robotics-paper-daily/Robotics-paper-daily.github.io/blob/v0.3.0/SECURITY.md).
