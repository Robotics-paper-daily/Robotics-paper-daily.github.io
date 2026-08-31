const test = require("node:test");
const assert = require("node:assert");

const { classifyOpenUrl } = require("../app/url-routing");

test("window-open routing permits only http(s) in-app pages", () => {
  assert.strictEqual(classifyOpenUrl("https://arxiv.org/abs/2608.12345"), "web");
  assert.strictEqual(classifyOpenUrl("http://example.com/"), "web");
  for (const value of [
    "obsidian://new?vault=x&content=owned",
    "file:///Users/test/secret",
    "mailto:test@example.com",
    "javascript:alert(1)",
    "data:text/html,hello",
    "not a url",
    "",
  ]) {
    assert.strictEqual(classifyOpenUrl(value), "deny", value);
  }
});
