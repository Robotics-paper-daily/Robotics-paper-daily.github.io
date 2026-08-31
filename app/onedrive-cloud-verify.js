"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const FILE_PROVIDER_CTL = "/usr/bin/fileproviderctl";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

class OneDriveCloudVerifyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OneDriveCloudVerifyError";
    this.code = code;
  }
}

function fail(code, message) {
  return new OneDriveCloudVerifyError(code, message);
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw fail("ABORTED", "OneDrive cloud verification was aborted");
  }
}

async function defaultDelay(ms, signal) {
  throwIfAborted(signal);
  if (ms <= 0) return;

  await new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(fail("ABORTED", "OneDrive cloud verification was aborted"));
    };

    timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isConfirmedEvaluation(output) {
  const text = typeof output === "string" ? output : Buffer.isBuffer(output) ? output.toString("utf8") : "";
  return /\bisUploaded\s*=\s*1\s*;/.test(text)
    && /\bisUploading\s*=\s*0\s*;/.test(text)
    && /\bisExcludedFromSync\s*=\s*0\s*;/.test(text)
    && /\bisSyncPaused\s*=\s*0\s*;/.test(text)
    && /\bhasUnresolvedConflicts\s*=\s*0\s*;/.test(text);
}

function executeFile(execFileImpl, command, args, signal, commandTimeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error, stdout) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(stdout);
    };

    let result;
    try {
      const options = {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: commandTimeoutMs,
      };
      if (signal) options.signal = signal;

      // Three-argument test doubles conventionally accept (command, args,
      // callback); node:child_process.execFile and four-argument doubles also
      // receive the options object so the real process can be aborted.
      result = execFileImpl.length === 3
        ? execFileImpl(command, args, done)
        : execFileImpl(command, args, options, done);
    } catch (error) {
      done(error);
      return;
    }

    if (result && typeof result.then === "function") {
      result.then(
        (value) => {
          const stdout = value && typeof value === "object" && "stdout" in value
            ? value.stdout
            : value;
          done(null, stdout);
        },
        done
      );
    }
  });
}

async function assertSafeFile(filePath) {
  let stats;
  try {
    stats = await fs.lstat(filePath);
  } catch {
    throw fail("FILE_NOT_ACCESSIBLE", "OneDrive file is not accessible");
  }

  if (stats.isSymbolicLink()) {
    throw fail("SYMLINK_NOT_ALLOWED", "OneDrive file must not be a symbolic link");
  }
  if (!stats.isFile()) {
    throw fail("NOT_REGULAR_FILE", "OneDrive path must point to a regular file");
  }
}

function timeoutError(commandSucceeded) {
  if (!commandSucceeded) {
    return fail("FILE_PROVIDER_COMMAND_FAILED", "fileproviderctl could not evaluate the OneDrive file");
  }
  return fail("CONFIRMATION_TIMEOUT", "Timed out waiting for OneDrive cloud confirmation");
}

/**
 * Wait until macOS File Provider confirms that a local OneDrive file is fully
 * uploaded and conflict-free.
 *
 * The returned object deliberately contains no `fileproviderctl` output.
 */
async function verifyOneDriveCloudFile(filePath, options = {}) {
  const platform = options.platform === undefined ? process.platform : options.platform;
  if (platform !== "darwin") {
    return { confirmed: false, reason: "unsupported-platform" };
  }

  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw fail("INVALID_PATH", "OneDrive file path must be absolute");
  }

  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const pollIntervalMs = options.pollIntervalMs === undefined
    ? DEFAULT_POLL_INTERVAL_MS
    : options.pollIntervalMs;
  const commandTimeoutMs = options.commandTimeoutMs === undefined
    ? DEFAULT_COMMAND_TIMEOUT_MS
    : options.commandTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw fail("INVALID_OPTIONS", "timeoutMs must be a non-negative finite number");
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw fail("INVALID_OPTIONS", "pollIntervalMs must be a positive finite number");
  }
  if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
    throw fail("INVALID_OPTIONS", "commandTimeoutMs must be a positive finite number");
  }

  const execFileImpl = options.execFileImpl || childProcess.execFile;
  const delay = options.delay || defaultDelay;
  const now = options.now || Date.now;
  const signal = options.signal;
  const deadline = now() + timeoutMs;
  let attempted = false;
  let commandSucceeded = false;

  while (true) {
    throwIfAborted(signal);
    if (attempted && now() >= deadline) throw timeoutError(commandSucceeded);
    attempted = true;

    await assertSafeFile(filePath);

    let output;
    try {
      output = await executeFile(
        execFileImpl,
        FILE_PROVIDER_CTL,
        ["evaluate", filePath],
        signal,
        commandTimeoutMs
      );
      commandSucceeded = true;
    } catch {
      throwIfAborted(signal);
      output = "";
    }

    throwIfAborted(signal);
    if (isConfirmedEvaluation(output)) {
      // Close the check/execute race before reporting success. In particular,
      // a file swapped for a symlink must never be accepted.
      await assertSafeFile(filePath);
      return { confirmed: true };
    }

    const remaining = deadline - now();
    if (remaining <= 0) throw timeoutError(commandSucceeded);

    try {
      await delay(Math.min(pollIntervalMs, remaining), signal);
    } catch (error) {
      throwIfAborted(signal);
      throw error;
    }
  }
}

module.exports = {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  OneDriveCloudVerifyError,
  isConfirmedEvaluation,
  verifyOneDriveCloudFile,
};
