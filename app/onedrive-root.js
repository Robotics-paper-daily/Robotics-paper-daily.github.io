"use strict";

// Windows OneDrive sync-root discovery. The OneDrive client publishes the
// sync roots of the signed-in accounts as per-user environment variables
// (OneDrive, OneDriveConsumer, OneDriveCommercial); an Explorer-launched
// Electron process inherits them. main.js resolves the configured linked
// attachment root against these candidates the same way the macOS build
// resolves against ~/Library/CloudStorage File Provider domains.

const path = require("path");

const WINDOWS_ONEDRIVE_ENV_KEYS = Object.freeze([
  "OneDrive",
  "OneDriveConsumer",
  "OneDriveCommercial",
]);

function windowsOneDriveRoots(env = process.env) {
  const roots = [];
  for (const key of WINDOWS_ONEDRIVE_ENV_KEYS) {
    const value = typeof env[key] === "string" ? env[key].trim() : "";
    if (!value || !path.isAbsolute(value)) continue;
    const resolved = path.resolve(value);
    if (!roots.includes(resolved)) roots.push(resolved);
  }
  return roots;
}

// True when `candidate` is `root` itself or nested inside it. Both arguments
// must already be resolved real paths; path.win32.relative compares Windows
// paths case-insensitively, so differing drive-letter or directory casing does
// not defeat the containment check.
function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

module.exports = {
  WINDOWS_ONEDRIVE_ENV_KEYS,
  windowsOneDriveRoots,
  isWithinRoot,
};
