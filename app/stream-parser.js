// Parse the `claude --output-format stream-json --verbose` NDJSON stream and
// map each raw event to a normalized, user-facing progress descriptor.
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

// Map a raw stream-json event → normalized descriptor, or null to ignore.
// Returned shapes (all carry `kind`):
//   {kind:'init', skills, model, permissionMode}
//   {kind:'phase', phase, label, detail}
//   {kind:'warn', label}
//   {kind:'text', text}                       (assistant thinking/text, last line)
//   {kind:'done', isError, resultText, denials, durationMs}
function mapEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

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
          for (const [re, phase, label] of SCRIPT_PHASES) {
            if (re.test(cmd)) return { kind: "phase", phase, label, detail: input.description };
          }
          return { kind: "phase", phase: "run", label: "执行脚本", detail: input.description };
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
      const line = lastText.trim().split("\n").filter(Boolean).pop();
      if (line) return { kind: "text", text: line.slice(0, 120) };
    }
    return null;
  }

  if (raw.type === "result") {
    return {
      kind: "done",
      isError: !!raw.is_error,
      resultText: typeof raw.result === "string" ? raw.result : "",
      denials: Array.isArray(raw.permission_denials) ? raw.permission_denials : [],
      durationMs: raw.duration_ms,
    };
  }

  return null;
}

module.exports = { makeParser, mapEvent };
