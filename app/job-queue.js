// In-memory job queue: each job is one local AI CLI paper-reading run.
// Bounded concurrency, url-dedup, cross-platform tree-kill cancel, a wall-clock
// watchdog, and post-run mapping back to the produced note folder.

const { shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const codexAdapter = require("./spawn-codex");
const claudeAdapter = require("./spawn-claude");
const traeAdapter = require("./spawn-trae");
const { makeParser, mapEvent } = require("./stream-parser");
const { cleanPaperCache, normalizeAppCacheDir } = require("./cache-clean");
const { repairFigures } = require("./figure-repair");
const { findBundledPaperReadingSkill } = require("./skill-locator");

let _seq = 0;
const nextId = () => "job_" + ++_seq;

function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function baseArxivId(id) {
  return id ? String(id).replace(/v\d+$/i, "") : null;
}

function safeExistingNote(vaultPath, notePath) {
  let root;
  let note;
  try {
    root = fs.realpathSync(vaultPath);
    const candidate = path.isAbsolute(notePath) ? notePath : path.resolve(root, notePath);
    note = fs.realpathSync(candidate);
  } catch {
    return null;
  }
  const rel = path.relative(root, note);
  if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;
  return note;
}

const WATCHDOG_MS = 20 * 60 * 1000;

class JobQueue {
  // settings: () => current settings object; onProgress: (evt) => void;
  // cacheDir: the main-process-derived <userData>/paper-cache path.
  constructor({ settings, onProgress, cacheDir }) {
    this.settings = settings;
    this.onProgress = onProgress || (() => {});
    this.cacheDir = normalizeAppCacheDir(cacheDir);
    this.jobs = [];
  }

  snapshot() {
    return this.jobs.map((j) => ({
      id: j.id,
      paperIndex: j.payload.paperIndex,
      reportFile: j.payload.reportFile,
      url: j.payload.url,
      arxivId: j.payload.arxivId,
      title: j.title,
      state: j.state,
      phase: j.phase,
      label: j.label,
      startedAt: j.startedAt,
      durationMs: j.durationMs,
      usage: j.usage,
      costUsd: j.costUsd,
      provider: j.provider,
      folderPath: j.folderPath,
      errorText: j.errorText,
    }));
  }

  findActiveByUrl(url) {
    return this.jobs.find(
      (j) => j.payload.url === url && (j.state === "queued" || j.state === "running")
    );
  }

  _runningCount() {
    return this.jobs.filter((j) => j.state === "running").length;
  }

  enqueue(payload, runtime = {}) {
    const job = {
      id: nextId(),
      payload,
      state: "queued",
      phase: "",
      label: "排队中",
      title: payload.title || payload.url,
      startedAt: Date.now(),
      child: null,
      stderr: "",
      folderPath: null,
      notePath: null,
      errorText: "",
      t0: 0,
      dateAtStart: null,
      watchdog: null,
      _result: null,
      usage: null,
      costUsd: null,
      durationMs: null,
      endedAt: 0,
      provider: null,
      runtime: {
        pythonPath: typeof runtime.pythonPath === "string" ? runtime.pythonPath : "",
        pythonReadRoots: Array.isArray(runtime.pythonReadRoots)
          ? runtime.pythonReadRoots.slice()
          : [],
      },
    };
    this.jobs.push(job);
    this._emit(job);
    this._pump();
    return job;
  }

  _emit(job, extra) {
    this.onProgress({
      jobId: job.id,
      paperIndex: job.payload.paperIndex,
      reportFile: job.payload.reportFile,
      url: job.payload.url,
      arxivId: job.payload.arxivId,
      title: job.title,
      state: job.state,
      phase: job.phase,
      label: job.label,
      folderPath: job.folderPath,
      errorText: job.errorText,
      startedAt: job.startedAt,
      durationMs: job.durationMs,
      usage: job.usage,
      costUsd: job.costUsd,
      provider: job.provider,
      ...(extra || {}),
    });
  }

  _pump() {
    const s = this.settings();
    const cap = s.concurrency || 2;
    for (const job of this.jobs) {
      if (job.state !== "queued") continue;
      if (this._runningCount() >= cap) break;
      this._start(job, s);
    }
  }

  _start(job, s) {
    const provider = ["codex", "claude", "trae"].includes(s.provider) ? s.provider : "codex";
    const adapter =
      provider === "codex" ? codexAdapter : provider === "claude" ? claudeAdapter : traeAdapter;
    const executablePath = provider === "codex"
      ? adapter.resolveCodexPath(s.codexPath)
      : provider === "claude"
        ? adapter.resolveClaudePath(s.claudePath)
        : adapter.resolveTraePath(s.traePath);
    if (!executablePath) {
      const name = provider === "codex" ? "Codex CLI" : provider === "claude" ? "claude" : "Trae CLI";
      return this._fail(job, `${name} 未找到（请在设置中指定路径）`);
    }
    if (!s.vaultPath || !fs.existsSync(s.vaultPath)) return this._fail(job, "vault 路径无效");
    const skillPath = findBundledPaperReadingSkill();
    if (!skillPath) return this._fail(job, "App 内置的 paper-reading 技能缺失");
    if (!this.cacheDir) return this._fail(job, "App 缓存目录无效，请重启 PaperReader");

    job.provider = provider;
    job.state = "running";
    job.phase = "init";
    job.label = "启动中";
    job.t0 = Date.now();
    job.dateAtStart = localDate();
    this._emit(job);

    let child;
    try {
      if (provider === "codex") {
        child = adapter.spawnRead({
          codexPath: executablePath,
          vaultPath: s.vaultPath,
          cacheDir: this.cacheDir,
          skillPath,
          url: job.payload.url,
          query: job.payload.query,
          model: s.codexModel,
          reasoningEffort: s.codexReasoningEffort,
          pythonPath: job.runtime && job.runtime.pythonPath,
          pythonReadRoots: job.runtime && job.runtime.pythonReadRoots,
        });
      } else if (provider === "claude") {
        child = adapter.spawnRead({
          claudePath: executablePath,
          vaultPath: s.vaultPath,
          cacheDir: this.cacheDir,
          skillPath,
          url: job.payload.url,
          query: job.payload.query,
          model: s.model,
          permissionMode: s.permissionMode,
          maxBudgetUsd: s.maxBudgetUsd,
          pythonPath: job.runtime && job.runtime.pythonPath,
        });
      } else {
        child = adapter.spawnRead({
          traePath: executablePath,
          vaultPath: s.vaultPath,
          cacheDir: this.cacheDir,
          skillPath,
          url: job.payload.url,
          query: job.payload.query,
          model: s.traeModel,
          backendVariant: s.traeBackendVariant,
          reasoningEffort: s.traeReasoningEffort,
          permissionMode: s.permissionMode,
          pythonPath: job.runtime && job.runtime.pythonPath,
        });
      }
    } catch (e) {
      return this._fail(job, "spawn 失败：" + e.message);
    }
    job.child = child;

    const parser = makeParser((raw) => this._onEvent(job, raw));
    child.stdout.on("data", (d) => parser.feed(d));
    child.stderr.on("data", (d) => {
      job.stderr = (job.stderr + d).slice(-8192);
    });
    child.on("error", (e) => this._fail(job, "进程错误：" + e.message));
    child.on("close", (code) => {
      parser.flush();
      this._onClose(job, code);
    });

    job.watchdog = setTimeout(() => {
      if (job.state === "running") {
        this._cancelChild(job);
        this._fail(job, "超时（>20min）已终止");
      }
    }, WATCHDOG_MS);
  }

  _onEvent(job, raw) {
    const ev = mapEvent(raw);
    if (!ev) return;
    switch (ev.kind) {
      case "init":
        if (Array.isArray(ev.skills) && !ev.skills.includes("paper-reading")) {
          job.label = "⚠ 未发现 paper-reading 技能（vault 路径可能不对）";
          this._emit(job, { phase: "warn", label: job.label });
        }
        return;
      case "warn":
        this._emit(job, { phase: "warn", label: ev.label });
        return;
      case "phase":
        job.phase = ev.phase;
        job.label = ev.label;
        if (ev.phase === "write" && ev.detail && /\.md$/i.test(ev.detail)) {
          job.notePath = ev.detail;
        }
        this._emit(job, { detail: ev.detail });
        return;
      case "text":
        this._emit(job, { phase: job.phase || "running", label: job.label, detail: ev.text });
        return;
      case "done":
        if (!job._result || !job._result.isError) job._result = ev;
        job.usage = ev.usage || null;
        job.costUsd = ev.costUsd != null ? ev.costUsd : null;
        if (ev.isError) job.errorText = ev.resultText || "读取出错";
        return;
    }
  }

  _onClose(job, code) {
    if (job.watchdog) {
      clearTimeout(job.watchdog);
      job.watchdog = null;
    }
    if (["canceled", "error", "done"].includes(job.state)) return this._pump();

    const res = job._result;
    if (res && res.isError) return this._fail(job, job.errorText || `读取失败 (code ${code})`);
    if (code !== 0) {
      const tail = (job.stderr || "").trim().split("\n").filter(Boolean).pop();
      return this._fail(job, tail || `退出码 ${code}`);
    }
    if (!res && code === 0) {
      return this._fail(job, "CLI 已退出，但未返回完成事件");
    }

    job.folderPath = this._resolveFolder(job);
    if (!job.folderPath) return this._fail(job, "CLI 已完成，但未找到本次生成的笔记");
    job.endedAt = Date.now();
    job.durationMs = job.endedAt - job.startedAt;
    job.state = "done";
    job.phase = "done";
    job.label = "已生成";
    this._emit(job);
    this._repairFigures(job);
    this._cleanCache(job);
    this._pump();
  }

  // Backstop for dangling figure embeds: if the note references figures the read
  // never actually downloaded, fetch them from the arxiv HTML. Async + best-effort
  // — only adds missing files, never edits the note. (See app/figure-repair.js.)
  _repairFigures(job) {
    if (!job.folderPath) return;
    const vaultPath = this.settings().vaultPath;
    repairFigures(job.folderPath, vaultPath, { provider: job.provider })
      .then((r) => {
        if (r && r.fetched > 0) {
          this._emit(job, { phase: "done", label: `已生成（补回 ${r.fetched} 张缺图）` });
        }
        if (r && r.failures && r.failures.length) {
          console.warn("[queue] figure repair partial:", job.id, JSON.stringify(r.failures));
        }
      })
      .catch((e) => console.error("[queue] figure repair failed:", e));
  }

  // After a note is produced, drop this paper's intermediate files from the
  // app-owned cache. Per-paper only: concurrent reads may still use the root.
  _cleanCache(job) {
    try {
      let id = job.payload.arxivId;
      if (job.folderPath) {
        const pdf = fs.readdirSync(job.folderPath).find((f) => /\.pdf$/i.test(f));
        if (pdf) id = pdf.replace(/\.pdf$/i, ""); // base id from the produced folder (covers name-based reads)
      }
      cleanPaperCache(this.cacheDir, id);
    } catch {}
  }

  _fail(job, msg) {
    if (job.watchdog) {
      clearTimeout(job.watchdog);
      job.watchdog = null;
    }
    if (!job.durationMs) job.durationMs = Date.now() - job.startedAt;
    job.state = "error";
    job.phase = "error";
    job.label = msg;
    job.errorText = msg;
    this._emit(job);
    this._pump();
  }

  // Map a finished job to the produced folder: the newest dir under
  // <vault>/<dateAtStart>/ created after the job started, preferring one that
  // contains <id>.pdf (exact even with concurrent reads into the same date).
  _resolveFolder(job) {
    const s = this.settings();
    if (job.notePath) {
      const note = safeExistingNote(s.vaultPath, job.notePath);
      if (note) {
        try {
          if (fs.statSync(note).mtimeMs >= job.t0 - 5000) {
            const folder = path.dirname(note);
            const id = baseArxivId(job.payload.arxivId);
            if (!id || fs.existsSync(path.join(folder, id + ".pdf"))) return folder;
          }
        } catch {}
      }
    }
    const dir = path.join(s.vaultPath, job.dateAtStart || localDate());
    if (!fs.existsSync(dir)) return null;
    let entries = [];
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          const p = path.join(dir, d.name);
          let t = 0;
          try {
            const st = fs.statSync(p);
            t = Math.max(st.birthtimeMs || 0, st.mtimeMs || 0);
            for (const file of fs.readdirSync(p)) {
              if (!/\.(md|pdf)$/i.test(file)) continue;
              try {
                t = Math.max(t, fs.statSync(path.join(p, file)).mtimeMs || 0);
              } catch {}
            }
          } catch {}
          return { p, t };
        });
    } catch {
      return null;
    }
    const pool = entries.filter((e) => e.t >= job.t0 - 5000);
    if (!pool.length) return null;
    const id = baseArxivId(job.payload.arxivId);
    if (id) {
      const m = pool.find((e) => fs.existsSync(path.join(e.p, id + ".pdf")));
      if (m) return m.p;
      return null;
    }
    const candidates = pool.filter((e) => {
      const expected = path.join(e.p, path.basename(e.p) + ".md");
      return fs.existsSync(expected);
    });
    return candidates.length === 1 ? candidates[0].p : null;
  }

  cancel(jobId) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return { ok: false, reason: "not-found" };
    if (job.state === "queued" || job.state === "running") {
      job.durationMs = Date.now() - job.startedAt;
    }
    if (job.state === "queued") {
      job.state = "canceled";
      job.label = "已取消";
      this._emit(job);
      return { ok: true };
    }
    if (job.state === "running") {
      job.state = "canceled";
      job.label = "已取消";
      this._cancelChild(job);
      this._emit(job);
      this._pump();
      return { ok: true };
    }
    return { ok: false, reason: "not-active" };
  }

  _cancelChild(job) {
    const child = job.child;
    if (!child || child.pid == null) return;
    try {
      if (process.platform === "win32") {
        // /T kills the CLI + its subprocess tree; /F forces termination.
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      } else {
        try {
          process.kill(-child.pid, "SIGTERM"); // negative pid = the process group
        } catch {
          child.kill("SIGTERM");
        }
        setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }, 3000);
      }
    } catch (e) {
      console.error("[queue] cancel kill failed:", e);
    }
  }

  _notePathFor(job) {
    if (job.notePath && fs.existsSync(job.notePath)) return job.notePath;
    if (job.folderPath) {
      const guess = path.join(job.folderPath, path.basename(job.folderPath) + ".md");
      if (fs.existsSync(guess)) return guess;
    }
    return null;
  }

  openFolder(jobId) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || !job.folderPath) return { ok: false, reason: "no-folder" };
    shell.openPath(job.folderPath);
    return { ok: true };
  }

  // obsidian://open?vault=<name>&file=<rel-no-ext>; falls back to opening the
  // folder if the note file can't be resolved.
  openInObsidian(jobId) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return { ok: false, reason: "not-found" };
    const s = this.settings();
    const note = this._notePathFor(job);
    if (!note) {
      if (job.folderPath) {
        shell.openPath(job.folderPath);
        return { ok: true, fallback: "folder" };
      }
      return { ok: false, reason: "no-note" };
    }
    const vaultName = path.basename(s.vaultPath);
    const rel = path.relative(s.vaultPath, note).replace(/\\/g, "/").replace(/\.md$/i, "");
    const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(rel)}`;
    shell.openExternal(uri);
    return { ok: true, uri };
  }
}

module.exports = { JobQueue, localDate, baseArxivId, safeExistingNote };
