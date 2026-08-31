// Parse Claude stream-json or Codex/TraeCode exec --json NDJSON and map all
// providers to the same user-facing progress descriptors.
//
// Stream shape (verified against CLI 2.1.150):
//   {type:"system",subtype:"init", cwd, model, skills:[...], permissionMode}
//   {type:"rate_limit_event", rate_limit_info:{status, overageStatus, ...}}
//   {type:"assistant", message:{content:[{type:"text"|"thinking"|"tool_use",...}]}}
//   {type:"result", subtype, is_error, result, permission_denials:[], duration_ms}

// NDJSON reader with partial-line buffering. Call feed(chunk) on each stdout
// chunk; onEvent(obj) fires per complete JSON line. Non-JSON lines are skipped.
function makeParser(onEvent) {
  let buf = "";
  return {
    feed(chunk) {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue; // tolerate noise / non-JSON stderr bleed
        }
        try {
          onEvent(obj);
        } catch (e) {
          // never let a consumer error kill the stream loop
          console.error("[parser] onEvent threw:", e);
        }
      }
    },
    flush() {
      const line = buf.trim();
      buf = "";
      if (!line) return;
      try {
        onEvent(JSON.parse(line));
      } catch {}
    },
  };
}

const SCRIPT_PHASES = [
  [/fetch_paper\.py/, "fetch", "抓取 PDF"],
  [/extract_text\.py/, "text", "提取正文"],
  [/fetch_html_figures\.py/, "figures", "处理图片"],
  [/extract_figures\.py/, "figures", "处理图片"],
  [/fetch_repo_files\.py/, "code", "拉取源码"],
];

function imageLike(p) {
  return typeof p === "string" && /\.(png|jpe?g|webp|gif)$/i.test(p);
}

function commandPhase(command, detail) {
  const cmd = String(command || "");
  for (const [re, phase, label] of SCRIPT_PHASES) {
    if (re.test(cmd)) return { kind: "phase", phase, label, detail };
  }
  return { kind: "phase", phase: "run", label: "执行脚本", detail: detail || cmd };
}

function lastLine(text) {
  if (!text) return null;
  const line = String(text).trim().split("\n").filter(Boolean).pop();
  return line ? line.slice(0, 120) : null;
}

function codexUsage(raw) {
  const u = raw || {};
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cached_input_tokens || 0,
    cacheCreate: u.cache_creation_input_tokens || 0,
  };
}

function fileChangePath(item) {
  if (typeof item.path === "string") return item.path;
  if (!Array.isArray(item.changes)) return "";
  for (const change of item.changes) {
    const p = change && (change.path || change.file_path || change.move_path);
    if (typeof p === "string" && /\.md$/i.test(p)) return p;
  }
  return "";
}

// Map a raw stream-json event → normalized descriptor, or null to ignore.
// Returned shapes (all carry `kind`):
//   {kind:'init', skills, model, permissionMode}
//   {kind:'phase', phase, label, detail}
//   {kind:'warn', label}
//   {kind:'text', text}                       (assistant thinking/text, last line)
//   {kind:'done', isError, resultText, denials, durationMs}
function mapEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

  if (raw.type === "thread.started") return null;
  if (raw.type === "turn.started") {
    return { kind: "init", skills: null, model: raw.model, permissionMode: raw.permission_mode };
  }

  if ((raw.type === "item.started" || raw.type === "item.completed") && raw.item) {
    const item = raw.item;
    if (item.type === "command_execution") {
      return commandPhase(item.command, item.command);
    }
    if (item.type === "agent_message") {
      const line = lastLine(item.text);
      return line ? { kind: "text", text: line } : null;
    }
    if (item.type === "file_change") {
      const p = fileChangePath(item);
      if (/\.md$/i.test(p)) return { kind: "phase", phase: "write", label: "写笔记", detail: p };
    }
    if (item.type === "mcp_tool_call" || item.type === "dynamic_tool_call") {
      const name = String(item.tool || item.name || item.tool_name || "");
      if (/apply_patch|write|edit/i.test(name)) {
        const args = item.arguments || item.input || {};
        const p = args.path || args.file_path || args.absolute_file_path || "";
        if (/\.md$/i.test(p)) return { kind: "phase", phase: "write", label: "写笔记", detail: p };
      }
    }
  }

  if (raw.type === "turn.completed") {
    return {
      kind: "done",
      isError: false,
      resultText: "",
      denials: [],
      durationMs: raw.duration_ms,
      usage: codexUsage(raw.usage),
      costUsd: null,
    };
  }

  if (raw.type === "turn.failed" || raw.type === "error") {
    const err = raw.error || {};
    return {
      kind: "done",
      isError: true,
      resultText: err.message || raw.message || "AI CLI 运行失败",
      denials: [],
      durationMs: raw.duration_ms,
      usage: codexUsage(raw.usage),
      costUsd: null,
    };
  }

  if (raw.type === "system" && raw.subtype === "init") {
    return {
      kind: "init",
      skills: Array.isArray(raw.skills) ? raw.skills : [],
      model: raw.model,
      permissionMode: raw.permissionMode,
      cwd: raw.cwd,
    };
  }

  if (raw.type === "rate_limit_event") {
    const info = raw.rate_limit_info || {};
    if (info.status && info.status !== "allowed") {
      const extra = info.overageDisabledReason ? `（${info.overageDisabledReason}）` : "";
      return { kind: "warn", label: `额度受限：${info.status}${extra}` };
    }
    return null;
  }

  if (raw.type === "assistant" && raw.message && Array.isArray(raw.message.content)) {
    let lastText = null;
    for (const block of raw.message.content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "tool_use") {
        const name = block.name;
        const input = block.input || {};
        if (name === "Bash" || name === "PowerShell") {
          const cmd = String(input.command || "");
          return commandPhase(cmd, input.description);
        }
        if (name === "Read" && imageLike(input.file_path)) {
          return { kind: "phase", phase: "read_image", label: "读图", detail: input.file_path };
        }
        if ((name === "Write" || name === "Edit") && /\.md$/i.test(input.file_path || "")) {
          return { kind: "phase", phase: "write", label: "写笔记", detail: input.file_path };
        }
        if (name === "Skill") {
          return { kind: "phase", phase: "init", label: "启动技能" };
        }
      } else if (block.type === "text" && block.text) {
        lastText = block.text;
      }
    }
    if (lastText) {
      const line = lastLine(lastText);
      if (line) return { kind: "text", text: line.slice(0, 120) };
    }
    return null;
  }

  if (raw.type === "result") {
    // The result event's top-level usage is cumulative for the whole run (it
    // sums its per-turn `iterations`); total_cost_usd is the notional API cost.
    const u = raw.usage || {};
    return {
      kind: "done",
      isError: !!raw.is_error,
      resultText: typeof raw.result === "string" ? raw.result : "",
      denials: Array.isArray(raw.permission_denials) ? raw.permission_denials : [],
      durationMs: raw.duration_ms,
      usage: {
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
        cacheCreate: u.cache_creation_input_tokens || 0,
      },
      costUsd: typeof raw.total_cost_usd === "number" ? raw.total_cost_usd : null,
    };
  }

  return null;
}

module.exports = { makeParser, mapEvent };
