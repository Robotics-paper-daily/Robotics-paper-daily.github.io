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
