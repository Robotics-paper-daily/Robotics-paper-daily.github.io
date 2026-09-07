"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { assertSupportedVersion, inspectLoadCommands, auditMacApp } = require("../app/macos-audit");

test("compares deployment targets numerically and accepts equivalent versions", () => {
  for (const version of ["10.15", "11.0", "12", "12.0", "12.0.0"]) {
    assert.doesNotThrow(() => assertSupportedVersion(version, "12.0.0", "fixture"));
  }
  assert.throws(() => assertSupportedVersion("12.1", "12.0.0", "helper"), /helper.*12.1.*12.0.0/);
  assert.throws(() => assertSupportedVersion("15.10", "15.2", "helper"), /helper.*15.10.*15.2/);
  assert.throws(() => assertSupportedVersion("unknown", "12.0.0", "helper"), /invalid.*version/i);
});

test("checks the deployment target rather than the SDK used to build a binary", () => {
  const output = `Load command 9
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 12.0
      sdk 26.4
   ntools 1
     tool 4
  version 1115.7.3
`;
  assert.doesNotThrow(() => inspectLoadCommands(output, "12.0.0", "Electron"));
  assert.throws(
    () => inspectLoadCommands(output.replace("minos 12.0", "minos 15.5"), "12.0.0", "Electron"),
    /Electron.*15.5.*12.0.0/
  );
});

test("checks legacy load commands and every architecture in a universal binary", () => {
  const legacy = `Load command 8
      cmd LC_VERSION_MIN_MACOSX
  cmdsize 16
  version 10.15
      sdk 14.5
`;
  assert.doesNotThrow(() => inspectLoadCommands(legacy, "12.0.0", "framework"));
  assert.throws(() => inspectLoadCommands(`${legacy}
Load command 9
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 13.0
      sdk 26.4
`, "12.0.0", "framework"), /framework.*13.0/);
  assert.throws(() => inspectLoadCommands("", "12.0.0", "helper"), /missing.*deployment target/i);
});

test("rejects a universal binary when a slice has no macOS deployment target", () => {
  const firstSlice = `/dev/fd/3 (architecture arm64):
Load command 8
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 12.0
      sdk 26.4
`;
  for (const secondSlice of [
    "Load command 1\n      cmd LC_UUID\n",
    "Load command 8\n      cmd LC_VERSION_MIN_IPHONEOS\n  version 12.0\n      sdk 18.0\n",
  ]) {
    assert.throws(() => inspectLoadCommands(
      `${firstSlice}/dev/fd/3 (architecture x86_64):\n${secondSlice}`, "12.0.0", "framework"
    ), /missing.*deployment target|non-macOS/);
  }
});

test("audits a real signed bundle with a parenthesized executable and rejects tampering", {
  skip: process.platform !== "darwin",
}, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-macos-audit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, "Fixture.app");
  const contents = path.join(bundle, "Contents");
  fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  const info = {
    CFBundleExecutable: "Fixture (GPU)",
    CFBundleIdentifier: "com.example.paperreader.audit",
    CFBundlePackageType: "APPL",
    LSMinimumSystemVersion: "12.0.0",
  };
  const plist = path.join(contents, "Info.plist");
  fs.writeFileSync(plist, JSON.stringify(info));
  execFileSync("/usr/bin/plutil", ["-convert", "xml1", plist]);
  execFileSync("/usr/bin/xcrun", [
    "clang", "-x", "c", "-", "-mmacosx-version-min=12.0", "-o",
    path.join(contents, "MacOS", info.CFBundleExecutable),
  ], { input: "int main(void) { return 0; }\n" });
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", bundle], { stdio: "pipe" });
  assert.deepEqual(auditMacApp(bundle, "12.0.0"), { binaries: 1, minimum: "12.0.0" });

  const helper = path.join(contents, "MacOS", "NewHelper");
  execFileSync("/usr/bin/xcrun", [
    "clang", "-x", "c", "-", "-mmacosx-version-min=13.0", "-o", helper,
  ], { input: "int main(void) { return 0; }\n" });
  assert.throws(() => auditMacApp(bundle, "12.0.0"), /NewHelper.*13.0.*12.0.0/);
  fs.unlinkSync(helper);

  execFileSync("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", "com.example.changed", plist]);
  assert.throws(() => auditMacApp(bundle, "12.0.0"), /codesign/);

  execFileSync("/usr/bin/plutil", ["-replace", "LSMinimumSystemVersion", "-string", "15.5", plist]);
  assert.throws(() => auditMacApp(bundle, "12.0.0"), /Info.plist.*15.5.*12.0.0/);
});
