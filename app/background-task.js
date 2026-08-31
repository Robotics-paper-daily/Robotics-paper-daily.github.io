// Run the handful of blocking environment/filesystem probes away from Electron's
// main thread. Each call gets a short-lived worker so callers can simply await a
// result without managing worker lifecycle or sharing mutable state.

const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const DEFAULT_TIMEOUT_MS = Object.freeze({
  probeEnv: 60_000,
  detectDefaults: 40_000,
  listTraeModels: 30_000,
  scanReadPapers: 30_000,
  sweepCache: 30_000,
});

const TASKS = Object.freeze({
  probeEnv(payload) {
    return require("./env-probe").probeEnv(payload);
  },
  detectDefaults() {
    return require("./env-probe").detectDefaults();
  },
  listTraeModels(payload) {
    return require("./spawn-trae").listModels(payload);
  },
  scanReadPapers(payload) {
    const vaultPath =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload.vaultPath
        : payload;
    return require("./vault-scan").scanReadPapers(vaultPath);
  },
  sweepCache(payload) {
    const cacheDir = payload && typeof payload === "object" ? payload.cacheDir : payload;
    const keepIds = payload && typeof payload === "object" ? payload.keepIds : undefined;
    return require("./cache-clean").sweepCache(cacheDir, { keepIds });
  },
});

function unknownTaskError(task) {
  const error = new Error(`Unknown background task: ${String(task)}`);
  error.name = "BackgroundTaskError";
  error.code = "BACKGROUND_TASK_UNKNOWN";
  return error;
}

// Error objects are not reliably preserved by structured clone (notably their
// custom `code`). Keep the wire shape deliberately small and clone-safe.
function serializeError(error) {
  const source = error instanceof Error ? error : new Error(String(error));
  const serialized = {
    name: typeof source.name === "string" ? source.name : "Error",
    message: typeof source.message === "string" ? source.message : String(source),
    stack: typeof source.stack === "string" ? source.stack : "",
  };
  if (typeof source.code === "string" || typeof source.code === "number") {
    serialized.code = source.code;
  }
  return serialized;
}

function deserializeError(serialized) {
  const data = serialized && typeof serialized === "object" ? serialized : {};
  const error = new Error(
    typeof data.message === "string" ? data.message : "Background task failed"
  );
  error.name = typeof data.name === "string" ? data.name : "BackgroundTaskError";
  error.code = data.code == null ? "BACKGROUND_TASK_FAILED" : data.code;
  if (typeof data.stack === "string" && data.stack) error.stack = data.stack;
  return error;
}

async function executeTask(task, payload) {
  if (!Object.prototype.hasOwnProperty.call(TASKS, task)) throw unknownTaskError(task);
  return TASKS[task](payload);
}

async function runWorker() {
  try {
    const value = await executeTask(workerData && workerData.task, workerData && workerData.payload);
    try {
      parentPort.postMessage({ ok: true, value });
    } catch (error) {
      // A future task accidentally returning a non-cloneable value must reject
      // its caller instead of crashing the worker without a useful reason.
      parentPort.postMessage({ ok: false, error: serializeError(error) });
    }
  } catch (error) {
    parentPort.postMessage({ ok: false, error: serializeError(error) });
  }
}

function runBackgroundTask(task, payload, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(TASKS, task)) {
    return Promise.reject(unknownTaskError(task));
  }

  const timeoutMs = options.timeoutMs == null ? DEFAULT_TIMEOUT_MS[task] : options.timeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new TypeError("background task timeoutMs must be a positive number"));
  }

  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(__filename, { workerData: { task, payload } });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let timer = null;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };

    timer = setTimeout(() => {
      const error = new Error(`Background task ${task} timed out after ${timeoutMs}ms`);
      error.name = "BackgroundTaskError";
      error.code = "BACKGROUND_TASK_TIMEOUT";
      settle(reject, error);
      // Stop sync filesystem/CLI work from accumulating if a provider hangs.
      // Any late exit/error is harmless because `settle` is one-shot.
      void worker.terminate().catch(() => {});
    }, timeoutMs);

    worker.once("message", (message) => {
      if (!message || typeof message !== "object" || typeof message.ok !== "boolean") {
        const error = new Error(`Background task ${task} returned an invalid response`);
        error.name = "BackgroundTaskError";
        error.code = "BACKGROUND_TASK_INVALID_RESPONSE";
        settle(reject, error);
        return;
      }
      if (message.ok) settle(resolve, message.value);
      else settle(reject, deserializeError(message.error));
    });

    worker.once("messageerror", (cause) => {
      const error = new Error(`Could not deserialize background task ${task} result`);
      error.name = "BackgroundTaskError";
      error.code = "BACKGROUND_TASK_MESSAGE_ERROR";
      error.cause = cause;
      settle(reject, error);
    });

    // Keep an error listener installed even after a result settles so a late
    // worker error can never become an unhandled EventEmitter `error` event.
    worker.once("error", (error) => settle(reject, error));
    worker.once("exit", (code) => {
      if (settled) return;
      const error = new Error(
        code === 0
          ? `Background task ${task} exited before returning a result`
          : `Background task ${task} worker exited with code ${code}`
      );
      error.name = "BackgroundTaskError";
      error.code = "BACKGROUND_TASK_WORKER_EXIT";
      settle(reject, error);
    });
  });
}

if (!isMainThread) {
  void runWorker();
} else {
  module.exports = { runBackgroundTask };
}
