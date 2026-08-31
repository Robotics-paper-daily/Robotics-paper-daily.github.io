const test = require("node:test");
const assert = require("node:assert");
const { mapEvent } = require("../app/stream-parser");

// Real shape captured from `claude --output-format stream-json --verbose` (opus):
// the result event's top-level usage is cumulative (sums its `iterations`).
test("mapEvent('result') surfaces tokens, cost, and duration", () => {
  const raw = {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5227,
    total_cost_usd: 0.08154575,
    result: "ok",
    permission_denials: [],
    usage: {
      input_tokens: 6,
      output_tokens: 48000,
      cache_read_input_tokens: 1200000,
      cache_creation_input_tokens: 30000,
    },
  };
  const ev = mapEvent(raw);
  assert.strictEqual(ev.kind, "done");
  assert.strictEqual(ev.isError, false);
  assert.strictEqual(ev.durationMs, 5227);
  assert.strictEqual(ev.costUsd, 0.08154575);
  assert.deepStrictEqual(ev.usage, { input: 6, output: 48000, cacheRead: 1200000, cacheCreate: 30000 });
});

test("mapEvent('result') tolerates a missing usage block", () => {
  const ev = mapEvent({ type: "result", is_error: true, result: "boom" });
  assert.strictEqual(ev.kind, "done");
  assert.strictEqual(ev.isError, true);
  assert.deepStrictEqual(ev.usage, { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
  assert.strictEqual(ev.costUsd, null);
});

test("mapEvent maps a Codex/Trae turn.started event to init", () => {
  const ev = mapEvent({ type: "turn.started", turn_id: "turn-1" });

  assert.strictEqual(ev.kind, "init");
});

test("mapEvent maps a Codex/Trae fetch_paper.py command_execution to the fetch phase", () => {
  const ev = mapEvent({
    type: "item.started",
    item: {
      id: "item-1",
      type: "command_execution",
      command: "python .agents/skills/paper-reading/scripts/fetch_paper.py 2608.01234",
      status: "in_progress",
    },
  });

  assert.deepStrictEqual(ev, {
    kind: "phase",
    phase: "fetch",
    label: "抓取 PDF",
    detail: "python .agents/skills/paper-reading/scripts/fetch_paper.py 2608.01234",
  });
});

test("mapEvent maps a Codex/Trae agent_message to its last non-empty line", () => {
  const ev = mapEvent({
    type: "item.completed",
    item: {
      id: "item-2",
      type: "agent_message",
      text: "I found the paper.\n\nNow extracting its figures.",
    },
  });

  assert.deepStrictEqual(ev, { kind: "text", text: "Now extracting its figures." });
});

test("mapEvent maps a Codex/Trae Markdown file_change to the write phase", () => {
  const ev = mapEvent({
    type: "item.completed",
    item: {
      id: "item-3",
      type: "file_change",
      changes: [{ path: "/vault/2026-08-05/paper/paper.md", kind: "update" }],
      status: "completed",
    },
  });

  assert.deepStrictEqual(ev, {
    kind: "phase",
    phase: "write",
    label: "写笔记",
    detail: "/vault/2026-08-05/paper/paper.md",
  });
});

test("mapEvent maps a Codex/Trae write tool call to the write phase", () => {
  const ev = mapEvent({
    type: "item.completed",
    item: {
      type: "dynamic_tool_call",
      name: "write_file",
      arguments: { path: "day/paper/paper.md" },
    },
  });
  assert.deepStrictEqual(ev, {
    kind: "phase",
    phase: "write",
    label: "写笔记",
    detail: "day/paper/paper.md",
  });
});

test("mapEvent maps Codex/Trae turn.completed usage to a successful done event", () => {
  const ev = mapEvent({
    type: "turn.completed",
    usage: {
      input_tokens: 1200,
      cached_input_tokens: 345,
      output_tokens: 678,
    },
  });

  assert.deepStrictEqual(ev, {
    kind: "done",
    isError: false,
    resultText: "",
    denials: [],
    durationMs: undefined,
    usage: { input: 1200, output: 678, cacheRead: 345, cacheCreate: 0 },
    costUsd: null,
  });
});

test("mapEvent maps a Codex/Trae turn.failed event to an error done event", () => {
  const ev = mapEvent({
    type: "turn.failed",
    error: { message: "The paper fetch failed" },
  });

  assert.deepStrictEqual(ev, {
    kind: "done",
    isError: true,
    resultText: "The paper fetch failed",
    denials: [],
    durationMs: undefined,
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    costUsd: null,
  });
});
