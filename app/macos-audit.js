"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function versionParts(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+){0,2}$/.test(value)) {
    throw new Error(`[macos-audit] invalid macOS version: ${value}`);
  }
  const parts = value.split(".").map(Number);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function assertSupportedVersion(required, supported, label) {
  const a = versionParts(required);
  const b = versionParts(supported);
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return;
    if (a[i] > b[i]) {
      throw new Error(`[macos-audit] ${label} requires macOS ${required}, above supported ${supported}`);
    }
  }
}

function inspectLoadCommands(output, minimum, label) {
  const slices = output.split(/^.* \(architecture [^)]+\):[ \t]*$/m);
  if (slices.length > 1) slices.shift();
  for (const slice of slices) inspectSliceLoadCommands(slice, minimum, label);
}

function inspectSliceLoadCommands(output, minimum, label) {
  let targets = 0;
  // SDK versions describe the build machine, not the oldest supported OS.
  // Each universal-binary slice must supply its own macOS deployment target.
  for (const block of output.split(/(?=Load command \d+)/)) {
    let match;
    if (/\bcmd LC_BUILD_VERSION\b/.test(block)) {
      if (!/\bplatform (?:1|macos)\s/i.test(block)) {
        throw new Error(`[macos-audit] ${label} has a non-macOS deployment target`);
      }
      match = block.match(/\bminos (\d+(?:\.\d+){0,2})\s/);
    } else if (/\bcmd LC_VERSION_MIN_MACOSX\b/.test(block)) {
      match = block.match(/\bversion (\d+(?:\.\d+){0,2})\s/);
    } else {
      continue;
    }
    if (!match) throw new Error(`[macos-audit] ${label} has an invalid deployment target`);
    assertSupportedVersion(match[1], minimum, label);
    targets++;
  }
  if (!targets) throw new Error(`[macos-audit] ${label} is missing a macOS deployment target`);
}

function native(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024, stdio: "pipe", ...options,
  });
}

function readPlist(file) {
  return JSON.parse(native("/usr/bin/plutil", ["-convert", "json", "-o", "-", file]));
}

function* bundleFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // Framework aliases point to the versioned files we already inspect.
    if (entry.isDirectory()) yield* bundleFiles(full);
    else if (entry.isFile()) yield full;
  }
}

const MACH_O_MAGICS = new Set([
  "feedface", "cefaedfe", "feedfacf", "cffaedfe",
  "cafebabe", "bebafeca", "cafebabf", "bfbafeca",
]);

function auditMacApp(appDir, minimum) {
  const info = readPlist(path.join(appDir, "Contents", "Info.plist"));
  assertSupportedVersion(info.LSMinimumSystemVersion, minimum, "Info.plist");
  assertSupportedVersion(minimum, info.LSMinimumSystemVersion, "configured minimum");

  let binaries = 0;
  for (const file of bundleFiles(appDir)) {
    const label = path.relative(appDir, file);
    if (path.basename(file) === "Info.plist") {
      const plist = readPlist(file);
      if (plist.LSMinimumSystemVersion !== undefined) {
        assertSupportedVersion(plist.LSMinimumSystemVersion, minimum, label);
      }
      for (const version of Object.values(plist.LSMinimumSystemVersionByArchitecture || {})) {
        assertSupportedVersion(version, minimum, label);
      }
    }
    const fd = fs.openSync(file, "r");
    const magic = Buffer.alloc(4);
    try {
      fs.readSync(fd, magic, 0, 4, 0);
      if (!MACH_O_MAGICS.has(magic.toString("hex"))) continue;
      // otool treats a trailing "(GPU)" as an archive member. An inherited
      // descriptor handles Electron helper names without renaming the bundle.
      inspectLoadCommands(native("/usr/bin/otool", ["-arch", "all", "-l", "/dev/fd/3"], {
        stdio: ["ignore", "pipe", "pipe", fd],
      }), minimum, label);
      binaries++;
    } finally {
      fs.closeSync(fd);
    }
  }
  if (!binaries) throw new Error("[macos-audit] no Mach-O binaries found in app bundle");
  native("/usr/bin/codesign", ["--verify", "--deep", "--strict", appDir]);
  return { binaries, minimum };
}

module.exports = { assertSupportedVersion, inspectLoadCommands, auditMacApp };
