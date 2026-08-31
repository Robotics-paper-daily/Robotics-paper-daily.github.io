const test = require("node:test");
const assert = require("node:assert");

const { EventEmitter } = require("node:events");
const { ReportGestureGate, wireReportGestureInput } = require("../app/report-gesture");

test("programmatic/no browser input cannot authorize a report mutation", () => {
  const gate = new ReportGestureGate({ now: () => 100 });
  assert.deepStrictEqual(gate.consume(), {
    allowed: false,
    code: "USER_GESTURE_REQUIRED",
  });
  assert.strictEqual(gate.notePointerInput({ type: "mouseMove" }), false);
  assert.strictEqual(gate.noteKeyboardInput({ type: "keyDown", key: "a" }), false);
  assert.strictEqual(gate.noteKeyboardInput({ type: "keyDown", key: "Enter", isAutoRepeat: true }), false);
  assert.strictEqual(gate.consume().allowed, false);
});

test("one physical pointer input can be consumed exactly once", () => {
  let now = 100;
  const gate = new ReportGestureGate({ now: () => now, ttlMs: 1500 });
  assert.strictEqual(gate.notePointerInput({ type: "mouseDown" }), true);
  now = 500;
  assert.deepStrictEqual(gate.consume(), { allowed: true, sequence: 1 });
  assert.deepStrictEqual(gate.consume(), {
    allowed: false,
    code: "USER_GESTURE_CONSUMED",
  });

  gate.notePointerInput({ type: "pointerDown" });
  assert.deepStrictEqual(gate.consume(), { allowed: true, sequence: 2 });
});

test("stale and clock-invalid inputs fail closed", () => {
  let now = 1000;
  const gate = new ReportGestureGate({ now: () => now, ttlMs: 1500 });
  gate.notePointerInput({ type: "touchStart" });
  now = 2501;
  assert.deepStrictEqual(gate.consume(), {
    allowed: false,
    code: "USER_GESTURE_EXPIRED",
  });

  now = 3000;
  gate.notePointerInput({ type: "gestureTapDown" });
  now = 2999;
  assert.strictEqual(gate.consume().code, "USER_GESTURE_EXPIRED");
});

test("Enter and Space are allowed once while other/repeated keys are ignored", () => {
  let now = 0;
  const gate = new ReportGestureGate({ now: () => now });
  assert.strictEqual(gate.noteKeyboardInput({ type: "keyDown", key: "Enter" }), true);
  assert.deepStrictEqual(gate.consume(), { allowed: true, sequence: 1 });
  now += 1;
  assert.strictEqual(gate.noteKeyboardInput({ type: "keyDown", key: " " }), true);
  assert.deepStrictEqual(gate.consume(), { allowed: true, sequence: 2 });
});

test("navigation reset invalidates an unconsumed input", () => {
  const gate = new ReportGestureGate({ now: () => 1 });
  gate.notePointerInput({ type: "mouseDown" });
  gate.reset();
  assert.deepStrictEqual(gate.consume(), {
    allowed: false,
    code: "USER_GESTURE_REQUIRED",
  });
});

test("Electron wiring records physical mouse input from before-mouse-event", () => {
  const webContents = new EventEmitter();
  const gate = new ReportGestureGate({ now: () => 100 });
  const unwire = wireReportGestureInput(webContents, gate);

  // Only the explicit pre-dispatch mouse channel is wired here; an unrelated
  // generic input event must not affect the gate through this integration.
  webContents.emit("input-event", {}, { type: "mouseDown" });
  assert.strictEqual(gate.consume().code, "USER_GESTURE_REQUIRED");

  webContents.emit("before-mouse-event", {}, { type: "mouseDown", x: 20, y: 30 });
  assert.deepStrictEqual(gate.consume(), { allowed: true, sequence: 1 });

  webContents.emit("before-input-event", {}, { type: "keyDown", key: "Enter" });
  assert.deepStrictEqual(gate.consume(), { allowed: true, sequence: 2 });

  unwire();
  webContents.emit("before-mouse-event", {}, { type: "mouseDown", x: 20, y: 30 });
  assert.strictEqual(gate.consume().code, "USER_GESTURE_CONSUMED");
});

test("Electron wiring rejects invalid collaborators", () => {
  const gate = new ReportGestureGate();
  assert.throws(() => wireReportGestureInput(null, gate), /webContents\.on/);
  assert.throws(() => wireReportGestureInput(new EventEmitter(), null), /ReportGestureGate/);
});
