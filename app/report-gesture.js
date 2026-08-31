// Browser-process-backed one-shot gate for privileged report operations.
// JavaScript dispatch (`element.click()`) does not produce a WebContents input
// event, and every physical input sequence can authorize at most one mutation.

"use strict";

const POINTER_START_TYPES = new Set(["mouseDown", "pointerDown", "touchStart", "gestureTapDown"]);
const ACTIVATION_KEYS = new Set(["Enter", " ", "Space", "Spacebar"]);

class ReportGestureGate {
  constructor(options = {}) {
    this._now = options.now || Date.now;
    this._ttlMs = options.ttlMs == null ? 1500 : options.ttlMs;
    this._sequence = 0;
    this._latest = null;
  }

  notePointerInput(input) {
    if (!input || !POINTER_START_TYPES.has(input.type)) return false;
    this._record(input.type);
    return true;
  }

  noteKeyboardInput(input) {
    if (
      !input ||
      input.type !== "keyDown" ||
      input.isAutoRepeat === true ||
      !ACTIVATION_KEYS.has(input.key)
    ) {
      return false;
    }
    this._record(`key:${input.key}`);
    return true;
  }

  _record(kind) {
    this._sequence += 1;
    this._latest = {
      sequence: this._sequence,
      kind,
      at: this._now(),
      consumed: false,
    };
  }

  consume() {
    const current = this._latest;
    if (!current) return { allowed: false, code: "USER_GESTURE_REQUIRED" };
    if (current.consumed) return { allowed: false, code: "USER_GESTURE_CONSUMED" };
    const age = this._now() - current.at;
    if (age < 0 || age > this._ttlMs) {
      return { allowed: false, code: "USER_GESTURE_EXPIRED" };
    }
    current.consumed = true;
    return { allowed: true, sequence: current.sequence };
  }

  reset() {
    this._latest = null;
  }
}

// Keep the Electron event wiring next to the gate so a unit test can verify the
// exact browser-process channels we depend on. The generic `input-event` does
// not provide the deterministic pre-dispatch signal this gate needs;
// Electron's `before-mouse-event` is explicitly pre-dispatch, so the one-shot
// grant exists before the report's click handler asks to consume it.
function wireReportGestureInput(webContents, gate) {
  if (!webContents || typeof webContents.on !== "function") {
    throw new TypeError("webContents.on is required");
  }
  if (!gate || typeof gate.notePointerInput !== "function" || typeof gate.noteKeyboardInput !== "function") {
    throw new TypeError("a ReportGestureGate-compatible gate is required");
  }

  const onMouse = (_event, input) => gate.notePointerInput(input);
  const onKeyboard = (_event, input) => gate.noteKeyboardInput(input);
  webContents.on("before-mouse-event", onMouse);
  webContents.on("before-input-event", onKeyboard);

  return () => {
    if (typeof webContents.removeListener !== "function") return;
    webContents.removeListener("before-mouse-event", onMouse);
    webContents.removeListener("before-input-event", onKeyboard);
  };
}

module.exports = {
  ACTIVATION_KEYS,
  POINTER_START_TYPES,
  ReportGestureGate,
  wireReportGestureInput,
};
