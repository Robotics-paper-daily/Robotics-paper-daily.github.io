const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "paperreader-settings-"));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return { app: { getPath: () => userData } };
  return originalLoad.call(this, request, parent, isMain);
};
const settings = require("../app/settings");
Module._load = originalLoad;

test.after(() => fs.rmSync(userData, { recursive: true, force: true }));

test("fresh settings default to the publicly available Codex provider", () => {
  const s = settings.load();
  assert.strictEqual(s.provider, "codex");
  assert.strictEqual(s.codexPath, "");
  assert.strictEqual(s.codexModel, "");
  assert.strictEqual(s.codexReasoningEffort, "");
  assert.strictEqual(s.model, "sonnet");
  assert.strictEqual(s.traeModel, "gpt-5.4");
  assert.strictEqual(s.traeBackendVariant, "max");
  assert.strictEqual(s.traeReasoningEffort, "ultra");
  assert.strictEqual(s.zoteroLinkedAttachmentRoot, "");
  assert.strictEqual(settings.providerConfigured(), false);
});

test("a legacy config without provider uses the documented Codex default", () => {
  fs.writeFileSync(settings.configFile(), JSON.stringify({ model: "sonnet" }));
  const s = settings.load();
  assert.strictEqual(s.provider, "codex");
  assert.strictEqual(s.model, "sonnet");
  assert.strictEqual(settings.providerConfigured(), false);
});

test("saving an explicit Trae provider persists the new defaults", () => {
  const saved = settings.merge({ provider: "trae" });
  assert.strictEqual(saved.provider, "trae");
  assert.strictEqual(settings.load().traeReasoningEffort, "ultra");
  assert.strictEqual(settings.providerConfigured(), true);
});

test("saving an explicit Codex provider and optional model settings persists", () => {
  const saved = settings.merge({
    provider: "codex",
    codexPath: "/usr/local/bin/codex",
    codexModel: "gpt-5.4",
    codexReasoningEffort: "high",
  });
  assert.strictEqual(saved.provider, "codex");
  assert.strictEqual(saved.codexPath, "/usr/local/bin/codex");
  assert.strictEqual(saved.codexModel, "gpt-5.4");
  assert.strictEqual(saved.codexReasoningEffort, "high");
});

test("a partial path save does not silently switch the selected provider", () => {
  fs.rmSync(settings.configFile(), { force: true });
  const saved = settings.merge({ traePath: "/usr/local/bin/trae-cli" });
  assert.strictEqual(saved.provider, "codex");
});

test("Zotero linked attachment root persists a trimmed absolute path", () => {
  const absoluteRoot = path.join(userData, "OneDrive", "Zotero-Attachments");
  const saved = settings.merge({ zoteroLinkedAttachmentRoot: `  ${absoluteRoot}  ` });
  assert.strictEqual(saved.zoteroLinkedAttachmentRoot, absoluteRoot);
  assert.strictEqual(settings.load().zoteroLinkedAttachmentRoot, absoluteRoot);

  const cleared = settings.merge({ zoteroLinkedAttachmentRoot: "   " });
  assert.strictEqual(cleared.zoteroLinkedAttachmentRoot, "");
});

test("Zotero linked attachment root rejects invalid merge values", () => {
  assert.throws(
    () => settings.merge({ zoteroLinkedAttachmentRoot: "OneDrive/Zotero-Attachments" }),
    /必须为空或绝对路径/
  );
  assert.throws(
    () => settings.merge({ zoteroLinkedAttachmentRoot: null }),
    /必须为空或绝对路径/
  );
});

test("load never exposes an invalid Zotero linked attachment root", () => {
  fs.writeFileSync(
    settings.configFile(),
    JSON.stringify({ provider: "trae", zoteroLinkedAttachmentRoot: "relative/path" })
  );
  assert.strictEqual(settings.load().zoteroLinkedAttachmentRoot, "");
});

test("settings UI wires the read-only Zotero root picker through paperBridge", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "settings.html"), "utf8");
  assert.match(html, /id="zoteroLinkedAttachmentRoot" readonly/);
  assert.match(html, /id="pickZoteroAttachmentRoot"/);
  assert.match(html, /bridge\.pickZoteroAttachmentRoot\(\)/);
  assert.match(html, /与 Zotero 设置中的[\s\S]*完全一致/);
});

test("settings UI exposes the real Codex provider, path picker, and optional model settings", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "settings.html"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "app", "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "app", "main.js"), "utf8");
  assert.match(html, /option value="codex">OpenAI Codex CLI（默认）/);
  assert.match(html, /id="codexPath"/);
  assert.match(html, /id="pickCodex"/);
  assert.match(html, /id="codexModel"/);
  assert.match(html, /id="codexReasoningEffort"/);
  assert.match(html, /id="openCodexGuide"/);
  assert.match(html, /developers\.openai\.com\/codex\/cli/);
  assert.match(html, /bridge\.pickCodex\(\)/);
  assert.match(preload, /pickCodex: \(\) => ipcRenderer\.invoke\("settings:pickCodex"\)/);
  assert.match(main, /ipcMain\.handle\("settings:pickCodex"/);
});

test("settings UI wires secure Zotero credential onboarding without echoing a saved key", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "settings.html"), "utf8");
  assert.match(html, /type="password"\s+id="zoteroApiKey"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /https:\/\/www\.zotero\.org\/settings\/keys\/new/);
  assert.match(html, /bridge\.getZoteroCredentialStatus\(\)/);
  assert.match(html, /bridge\.verifyAndSaveZoteroCredentials\(apiKey\)/);
  assert.match(html, /bridge\.clearZoteroCredentials\(\)/);
  assert.match(html, /input\.value = ""/);
  assert.match(html, /验证并安全保存/);
  assert.match(html, /保存全部设置/);
  assert.match(html, /关闭或重启 App 后仍会使用/);
  assert.match(html, /async function verifyAndPersistPendingZoteroKey/);
  assert.match(html, /input\.disabled = true[\s\S]*clearButton\.disabled = true/);
  assert.match(html, /clearButton\.disabled = savedSuccessfully \? false : clearButtonWasDisabled/);
  assert.match(html, /zoteroApiKey[\s\S]*addEventListener\("keydown"[\s\S]*event\.key !== "Enter"/);

  const saveAllHandler = /\$\("save"\)\.addEventListener\("click", async \(\) => \{([\s\S]*?)\n      \}\);/.exec(html);
  assert.ok(saveAllHandler);
  assert.match(saveAllHandler[1], /await verifyAndPersistPendingZoteroKey\(\)/);
  assert.match(saveAllHandler[1], /await bridge\.setSettings\(formSettings\(\)\)/);
  assert.ok(
    saveAllHandler[1].indexOf("verifyAndPersistPendingZoteroKey") <
      saveAllHandler[1].indexOf("bridge.setSettings"),
    "the page-level save must persist a pending API key before ordinary settings"
  );

  const formBody = /function formSettings\(\) \{([\s\S]*?)\n      \}/.exec(html);
  assert.ok(formBody);
  assert.doesNotMatch(formBody[1], /zoteroApiKey|apiKey/);
});

test("settings UI surfaces a resolved credential-clear failure", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "settings.html"), "utf8");
  assert.match(html, /const result = await bridge\.clearZoteroCredentials\(\)/);
  assert.match(html, /if \(!result \|\| result\.ok !== true\)/);
  assert.match(
    html,
    /throw new Error\(\(result && result\.reason\) \|\| "API key 清除失败"\)/
  );
});

test("settings UI shows Zotero auto-detection and exact-root match status", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "settings.html"), "utf8");
  assert.match(html, /id="zoteroSetupStatus"/);
  assert.match(html, /bridge\.getZoteroSetupStatus\(/);
  assert.match(html, /status\.zoteroBaseDir \|\| status\.detectedRoot/);
  assert.match(html, /status\.match === true/);
  assert.match(html, /PaperReader 与 Zotero 的目录完全一致/);
});

test("App shell keeps a persistent Zotero setup entry until credentials exist", () => {
  const shell = fs.readFileSync(path.join(__dirname, "..", "app", "shell.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "app", "renderer.js"), "utf8");
  assert.match(shell, /id="zotero-setup-btn"[\s\S]*配置 Zotero/);
  assert.match(renderer, /zoteroSetupBtn\.hidden = !!_zoteroCredentials/);
  assert.match(renderer, /zoteroSetupBtn\.addEventListener\("click", \(\) => bridge\.openSettings\(\)\)/);
});

test("settings inline script remains syntactically valid", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "settings.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.strictEqual(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0]));
});

test("merge refuses to overwrite a malformed existing config", () => {
  fs.writeFileSync(settings.configFile(), "{broken");
  assert.throws(() => settings.merge({ provider: "trae" }), /现有配置无法读取/);
});
