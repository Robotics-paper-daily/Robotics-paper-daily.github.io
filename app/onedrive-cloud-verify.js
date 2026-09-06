"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const FILE_PROVIDER_CTL = "/usr/bin/fileproviderctl";
const WINDOWS_POWERSHELL = "powershell.exe";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

// Windows file-attribute bits used by the cloud-files (OneDrive) sync engine.
// A brand-new file written into the sync root is a plain file; once the sync
// engine has uploaded it and marked it in sync, it converts the file into a
// cloud placeholder carrying FILE_ATTRIBUTE_REPARSE_POINT (possibly with the
// dehydration bits set later). Confirmation therefore requires the reparse
// bit; anything else keeps polling and eventually fails closed.
const WIN_ATTR_REPARSE_POINT = 0x400;
const WIN_ATTR_OFFLINE = 0x1000;
const WIN_ATTR_RECALL_ON_OPEN = 0x40000;
const WIN_ATTR_RECALL_ON_DATA_ACCESS = 0x400000;

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

// The PowerShell probe prints the raw FILE_ATTRIBUTE_* DWORD as a decimal
// integer. Only an in-sync cloud placeholder (reparse point set) counts as
// uploaded; a dehydrated placeholder additionally carries the recall/offline
// bits and is uploaded by definition. A plain file — still uploading, sync
// paused, or a sync client without cloud placeholders — is never confirmed.
function isConfirmedWindowsAttributes(output) {
  const text = typeof output === "string" ? output : Buffer.isBuffer(output) ? output.toString("utf8") : "";
  const match = text.trim().match(/^-?\d+$/);
  if (!match) return false;
  const attributes = Number.parseInt(match[0], 10);
  if (!Number.isSafeInteger(attributes) || attributes < 0) return false;
  return (attributes & WIN_ATTR_REPARSE_POINT) !== 0;
}

// Build the PowerShell invocation that reads the raw attribute DWORD for one
// file. The path is embedded in a single-quoted PowerShell literal (no variable
// or expression expansion); embedded single quotes are doubled per PowerShell
// quoting rules, and control characters are rejected outright because no valid
// Windows path contains them.
function windowsAttributeCommand(filePath) {
  if (/[\u0000-\u001f\u007f]/.test(filePath)) {
    throw fail("INVALID_PATH", "The OneDrive file path contains control characters");
  }
  const literal = filePath.replace(/'/g, "''");
  return {
    command: WINDOWS_POWERSHELL,
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `[int](Get-Item -LiteralPath '${literal}' -Force).Attributes`,
    ],
  };
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
        windowsHide: true,
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
    return fail("FILE_PROVIDER_COMMAND_FAILED", "The system could not evaluate the OneDrive sync state");
  }
  return fail("CONFIRMATION_TIMEOUT", "Timed out waiting for OneDrive cloud confirmation");
}

// Per-platform probe: which command reports the file's cloud state, and how a
// confirming report looks. Anything else keeps polling until the deadline.
function cloudProbeFor(platform, filePath) {
  if (platform === "darwin") {
    return {
      command: FILE_PROVIDER_CTL,
      args: ["evaluate", filePath],
      isConfirmed: isConfirmedEvaluation,
    };
  }
  if (platform === "win32") {
    const invocation = windowsAttributeCommand(filePath);
    return {
      command: invocation.command,
      args: invocation.args,
      isConfirmed: isConfirmedWindowsAttributes,
    };
  }
  return null;
}

/**
 * Wait until the platform's sync layer confirms that a local OneDrive file is
 * fully uploaded and conflict-free: macOS File Provider (`fileproviderctl
 * evaluate`) on darwin, the cloud-files placeholder attributes on Windows.
 *
 * The returned object deliberately contains no probe output.
 */
async function verifyOneDriveCloudFile(filePath, options = {}) {
  const platform = options.platform === undefined ? process.platform : options.platform;
  if (platform !== "darwin" && platform !== "win32") {
    return { confirmed: false, reason: "unsupported-platform" };
  }

  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw fail("INVALID_PATH", "OneDrive file path must be absolute");
  }
  const probe = cloudProbeFor(platform, filePath);

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
        probe.command,
        probe.args,
        signal,
        commandTimeoutMs
      );
      commandSucceeded = true;
    } catch {
      throwIfAborted(signal);
      output = "";
    }

    throwIfAborted(signal);
    if (probe.isConfirmed(output)) {
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
  WIN_ATTR_REPARSE_POINT,
  WIN_ATTR_OFFLINE,
  WIN_ATTR_RECALL_ON_OPEN,
  WIN_ATTR_RECALL_ON_DATA_ACCESS,
  OneDriveCloudVerifyError,
  isConfirmedEvaluation,
  isConfirmedWindowsAttributes,
  windowsAttributeCommand,
  verifyOneDriveCloudFile,
};
