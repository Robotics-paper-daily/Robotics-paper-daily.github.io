# PaperReader (desktop app)

A thin Electron wrapper around the daily-papers site that adds a **「帮我读」**
button to every candidate paper. Clicking it runs your **local Claude Code
subscription** with the `paper-reading` skill (in your Obsidian vault) to
deep-read that paper and generate a structured note folder — all driven from the
paper list, cross-platform (Windows + macOS).

It also pulls the latest papers **live on launch** (no git pull), marks papers
you've **already read** (a note exists in your vault), and can unlock the report's
**Zotero** "Add to Zotero" buttons with your existing personal-mode password.

This only exists as a desktop app because a static web page can't spawn a local
process. The public GitHub Pages site stays unchanged — the read button is the
app's own injection and never appears there.

## How it works

```
report card 「帮我读」 (js/read-paper.js, injected into the report iframe)
  └─ window.top.paperBridge.read({url,…})        (preload, app:// same-origin)
       └─ main.js JobQueue → spawn the native claude binary
            -p "<prompt>" --output-format stream-json --verbose
            --permission-mode bypassPermissions --model <opus|sonnet|…>
            cwd = <vault>            ← makes the paper-reading skill discoverable
       └─ stream-json parsed → progress sidebar + the card's button state
  produced: <vault>/<date>/<title>/{<title>.md, <id>.pdf, attachments/, code/}
            → open folder / open in Obsidian
```

Auth is your existing Claude Code login (subscription / OAuth) — the app never
sets `ANTHROPIC_API_KEY`, so reads bill against your plan, not the API.

**Latest papers, no git pull.** The `app://` protocol live-fetches
`reports.json` + report pages from the live GitHub Pages site (`liveBase`,
default `https://robotics-paper-daily.github.io`) on each load, caches them under
the app's userData for offline use, and falls back cache → bundled `site/`
snapshot when offline. The public pages don't carry the read button — the proxy
injects `read-paper.js`, which (in app mode) injects a 帮我读 button next to each
card. The public site is never modified. Clear `liveBase` to run fully offline.

**Already-read markers.** On load the app scans your **local** vault for existing
notes (a folder with `<id>.pdf` + its `.md`) and shows those papers as a blue
**✓ 已读** button — clicking opens the existing note instead of re-reading.
Cross-device is your own Obsidian sync (e.g. WebDAV); the app only reads this
machine's vault.

**Zotero (optional).** On launch a password overlay unlocks personal mode by
decrypting the same `secrets.enc.js` bundle as the public site's gate — then the
report's existing "Add to Zotero" buttons work. Click **跳过** to use 帮我读 only.

## Prerequisites

- **Claude Code CLI** installed and logged in (`claude`). A deep read uses your
  subscription quota — on `opus` (the default) it's stronger but pricier/slower
  than `sonnet`; switch the model in settings to trade quality for quota.
- **The Obsidian vault** with the skill at
  `<vault>/.claude/skills/paper-reading/SKILL.md`.

Both are auto-detected on first run; if either is missing the settings window
opens so you can point at them.

## Run it

```sh
cd app
npm install        # first time only
npm start          # prestart syncs the offline snapshot, then launches
```

Or just double-click **`run-windows.bat`** (Windows) / **`run-mac.command`**
(macOS — `chmod +x run-mac.command` once): they `npm install` on first run, then
launch.

On launch: enter your Zotero password (or **跳过**) → the latest report loads →
click green **帮我读** on a paper to read it (progress in the right sidebar,
~minutes) → **在 Obsidian 打开** when done. Blue **已读** papers are already in
your vault. Top-right **设置** configures vault/claude paths, model, concurrency,
the data source, and a per-read budget cap.

## Settings

`config.json` under the userData dir (`%APPDATA%\PaperReader\config.json` on
Windows; `~/Library/Application Support/PaperReader/` on macOS):

| key | default | meaning |
|---|---|---|
| `vaultPath` | auto | Obsidian vault containing the skill |
| `claudePath` | auto | override the claude binary path |
| `liveBase` | the github.io URL | pull the latest papers from here; clear = offline-only (bundled snapshot) |
| `model` | `opus` | `--model` (opus = strongest; `sonnet`/`haiku` conserve the 5-hour quota) |
| `concurrency` | `10` | simultaneous reads (1–16) |
| `maxBudgetUsd` | `0` | per-read `--max-budget-usd` cap (0 = off) |
| `permissionMode` | `bypassPermissions` | headless runs can't answer permission prompts |

## Build installers

**Recommended: GitHub Actions** — the `Build PaperReader app` workflow
(`.github/workflows/build-app.yml`, manual dispatch or an `app-v*` tag) builds
both the Windows `.exe` and the macOS `.dmg` on clean runners. The mac `.dmg`
*must* be built on a mac (no cross-build from Windows), so CI is the path for it.

Local Windows build:

```sh
cd app && npm run dist:win      # → app/dist/*.exe
```

Two machine-specific gotchas can break a *local* Windows build (CI is unaffected):
- **electron-builder needs Developer Mode** (or an elevated/admin shell) to
  extract its `winCodeSign` toolchain, which contains symlinks Windows won't
  create otherwise. Enable Settings → Privacy & security → For developers →
  Developer Mode, then rebuild.
- If your `%LOCALAPPDATA%` is a junction to another drive, electron-builder's
  cache move fails ("cannot move to a different disk drive"). Point the caches
  at one drive first: set `ELECTRON_CACHE` and `ELECTRON_BUILDER_CACHE` (and
  `TEMP`) to folders on the same drive, then rebuild.

Builds are unsigned (personal use). On macOS, right-click → Open the first time
to bypass Gatekeeper.

## Known caveats

- **Quota**: `opus` + high concurrency burns the 5-hour subscription quota fast
  (overage is disabled), so a burst of reads can hit the limit — failed reads go
  to an error state and can be retried. Drop to `sonnet` / lower `concurrency`,
  or set `maxBudgetUsd`, to conserve.
- **Re-reading a paper may create a second folder** instead of overwriting, if
  the skill sanitizes the title slightly differently from an existing note. The
  app always opens the newest folder that contains `<id>.pdf`, so "open note"
  still points at the right one; stale duplicates can be deleted manually.
- **Report pages use CDN assets** (Tailwind / framer-motion / Font Awesome), so
  the app needs network at view time to render fully styled (reads need network
  anyway).

## Files

| file | role |
|---|---|
| `main.js` | window, `app://` live-fetch proxy, IPC, orchestration |
| `preload.js` | `window.paperBridge` over IPC (contextIsolation) |
| `shell.html` / `renderer.js` | app window: Zotero unlock gate, date picker, report iframe, progress sidebar |
| `settings.html` | first-run / settings window |
| `../js/read-paper.js` | injects the 帮我读 / 已读 buttons + wiring (no-op on the public site) |
| `spawn-claude.js` | resolve `claude` + spawn the headless read |
| `stream-parser.js` | NDJSON stream-json → normalized progress phases |
| `job-queue.js` | concurrency, dedup, tree-kill cancel, watchdog, folder mapping |
| `vault-scan.js` | scan the local vault for already-read papers |
| `settings.js` / `env-probe.js` | config + vault/claude/skill detection |
| `sync-site.js` | snapshot `../daily_html ../js ../reports.json` → `site/` (offline fallback) |
| `run-windows.bat` / `run-mac.command` | double-click launchers |
