"use strict";

const fs = require("node:fs");
const path = require("node:path");

class ZoteroProfileError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ZoteroProfileError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new ZoteroProfileError(code, message, cause ? { cause } : undefined);
}

function profilePathFromIni(text, zoteroSupportDir) {
  const sections = [];
  let current = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = /^\[([^\]]+)\]$/.exec(line);
    if (heading) {
      current = { name: heading[1], values: {} };
      sections.push(current);
      continue;
    }
    if (!current || !line || line.startsWith(";") || line.startsWith("#")) continue;
    const split = line.indexOf("=");
    if (split < 0) continue;
    current.values[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  const profiles = sections.filter((section) => /^Profile\d+$/i.test(section.name));

  const resolveProfile = (section) => {
    if (!section || !section.values.Path) return null;
    return section.values.IsRelative === "1"
      ? path.resolve(zoteroSupportDir, section.values.Path)
      : path.resolve(section.values.Path);
  };

  // Newer Firefox-derived profile registries can bind an installation to a
  // profile through [Install<hash>] Default=Profiles/<name>, even when the
  // matching [ProfileN] section has no Default=1 flag. Zotero normally has a
  // single installation per user on macOS and Windows; only treat the install
  // mapping as authoritative when all install sections agree on one known
  // profile.
  const installPaths = new Set(
    sections
      .filter((section) => /^Install/i.test(section.name) && section.values.Default)
      .map((section) =>
        path.isAbsolute(section.values.Default)
          ? path.resolve(section.values.Default)
          : path.resolve(zoteroSupportDir, section.values.Default)
      )
  );
  const installMatches = profiles.filter((section) => installPaths.has(resolveProfile(section)));
  const uniqueInstallPaths = new Set(installMatches.map(resolveProfile));
  const installSelected = uniqueInstallPaths.size === 1 ? installMatches[0] : null;
  const selected =
    installSelected || profiles.find((section) => section.values.Default === "1") || profiles[0];
  if (!selected || !selected.values.Path) {
    fail("ZOTERO_PROFILE_UNAVAILABLE", "Zotero default profile is not configured");
  }
  return resolveProfile(selected);
}

function baseAttachmentPathFromPrefs(text) {
  const match = String(text || "").match(
    /user_pref\("extensions\.zotero\.baseAttachmentPath",\s*("(?:\\.|[^"\\])*")\s*\);/
  );
  if (!match) {
    fail("ZOTERO_BASE_UNAVAILABLE", "Zotero Linked Attachment Base Directory is not configured");
  }
  try {
    const value = JSON.parse(match[1]);
    if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("not absolute");
    return value;
  } catch (cause) {
    fail("ZOTERO_BASE_UNAVAILABLE", "Zotero Linked Attachment Base Directory is invalid", cause);
  }
}

// Where the Zotero desktop app keeps profiles.ini for the current user.
// macOS: ~/Library/Application Support/Zotero
// Windows: %APPDATA%\Zotero\Zotero (Roaming). Other platforms are unsupported.
function zoteroSupportDir({ homeDir, appDataDir, platform }) {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "Zotero");
  }
  if (platform === "win32") {
    const roaming =
      typeof appDataDir === "string" && path.isAbsolute(appDataDir)
        ? appDataDir
        : path.join(homeDir, "AppData", "Roaming");
    return path.join(roaming, "Zotero", "Zotero");
  }
  return null;
}

function readZoteroBaseAttachmentPath(options = {}) {
  const homeDir = options.homeDir;
  const fsImpl = options.fsImpl || fs;
  const platform = options.platform === undefined ? process.platform : options.platform;
  if (typeof homeDir !== "string" || !path.isAbsolute(homeDir)) {
    fail("ZOTERO_PROFILE_UNAVAILABLE", "A valid home directory is required");
  }
  const supportDir = zoteroSupportDir({ homeDir, appDataDir: options.appDataDir, platform });
  if (!supportDir) {
    fail("ZOTERO_PROFILE_UNAVAILABLE", "Zotero profile detection is not supported on this platform");
  }
  try {
    const ini = fsImpl.readFileSync(path.join(supportDir, "profiles.ini"), "utf8");
    const profileDir = profilePathFromIni(ini, supportDir);
    const prefs = fsImpl.readFileSync(path.join(profileDir, "prefs.js"), "utf8");
    return baseAttachmentPathFromPrefs(prefs);
  } catch (error) {
    if (error instanceof ZoteroProfileError) throw error;
    fail("ZOTERO_PROFILE_UNAVAILABLE", "Could not read the Zotero profile", error);
  }
}

module.exports = {
  ZoteroProfileError,
  baseAttachmentPathFromPrefs,
  profilePathFromIni,
  readZoteroBaseAttachmentPath,
  zoteroSupportDir,
};
