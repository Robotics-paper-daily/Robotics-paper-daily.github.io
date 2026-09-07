"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { auditMacApp } = require("../../app/macos-audit");
const { auditAsar, auditPackagedResources } = require("../../app/release-audit");
const asar = require("../../app/node_modules/@electron/asar");
const pkg = require("../../app/package.json");

const dist = path.resolve(process.argv[2] || path.join(__dirname, "../../app/dist"));
for (const arch of ["arm64", "x64"]) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-dmg-audit-"));
  const mount = path.join(temp, "mounted");
  let attached = false;
  try {
    const dmg = path.join(dist, `PaperReader-${pkg.version}-${arch}.dmg`);
    execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg], { stdio: "pipe", timeout: 120_000 });
    attached = true;
    const app = path.join(mount, "PaperReader.app");
    const info = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }));
    if (info.CFBundleShortVersionString !== pkg.version) throw new Error(`${arch} DMG has wrong app version`);
    const binary = path.join(app, "Contents/MacOS", info.CFBundleExecutable);
    const actualArch = execFileSync("lipo", ["-archs", binary], { encoding: "utf8" }).trim();
    if (actualArch !== (arch === "x64" ? "x86_64" : "arm64")) throw new Error(`${arch} DMG has wrong CPU architecture`);
    auditMacApp(app, pkg.build.mac.minimumSystemVersion);
    const resources = path.join(app, "Contents/Resources");
    const archive = path.join(resources, "app.asar");
    if (JSON.parse(asar.extractFile(archive, "package.json")).version !== pkg.version) throw new Error(`${arch} DMG has wrong packaged source version`);
    auditAsar(archive, asar);
    auditPackagedResources(resources);
    console.log(`[macos-dmg-audit] ${arch}: version, architecture, privacy, deployment targets and signature passed`);
  } finally {
    if (attached) execFileSync("hdiutil", ["detach", mount], { stdio: "pipe", timeout: 60_000 });
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
