"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CURRENT_KEY_URL,
  verifyZoteroApiKey,
} = require("../app/zotero-key-verify");

// Repeated characters are intentionally unmistakable release-audit fixtures,
// never values copied from a Zotero account.
const API_KEY = "AAAAAAAAAAAAAAAAAAAAAAAA";

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

async function expectCode(promise, code, forbiddenText = API_KEY) {
  await assert.rejects(promise, (error) => {
    assert.strictEqual(error.code, code);
    assert.doesNotMatch(error.message, new RegExp(forbiddenText));
    return true;
  });
}

test("rejects a malformed API key before making a request", async () => {
  let called = false;
  await expectCode(
    verifyZoteroApiKey("not-a-key", {
      fetchImpl: async () => {
        called = true;
      },
    }),
    "INVALID_API_KEY",
    "not-a-key"
  );
  assert.strictEqual(called, false);
});

test("sends the key only in Zotero's required versioned headers", async () => {
  const controller = new AbortController();
  let request = null;
  const result = await verifyZoteroApiKey(` ${API_KEY} `, {
    signal: controller.signal,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response(200, {
        userID: 123456,
        access: { user: { library: true, write: true } },
      });
    },
  });

  assert.deepStrictEqual(result, { apiKey: API_KEY, userId: "123456" });
  assert.strictEqual(request.url, CURRENT_KEY_URL);
  assert.deepStrictEqual(request.options.headers, {
    "Zotero-API-Key": API_KEY,
    "Zotero-API-Version": "3",
  });
  assert.strictEqual(request.options.method, "GET");
  assert.strictEqual(request.options.redirect, "error");
  assert.strictEqual(request.options.cache, "no-store");
  assert.strictEqual(request.options.signal, controller.signal);
  assert.doesNotMatch(request.url, new RegExp(API_KEY));
});

for (const status of [401, 403]) {
  test(`maps Zotero ${status} to a stable auth error`, async () => {
    const promise = verifyZoteroApiKey(API_KEY, {
      fetchImpl: async () => response(status, { leaked: API_KEY }),
    });
    await assert.rejects(promise, (error) => {
      assert.strictEqual(error.code, "AUTH_REJECTED");
      assert.strictEqual(error.status, status);
      assert.doesNotMatch(error.message, new RegExp(API_KEY));
      return true;
    });
  });
}

test("maps an external timeout/abort without exposing the key", async () => {
  const controller = new AbortController();
  controller.abort(new Error(`timeout ${API_KEY}`));
  await expectCode(
    verifyZoteroApiKey(API_KEY, {
      signal: controller.signal,
      fetchImpl: async (_url, options) => {
        assert.strictEqual(options.signal, controller.signal);
        throw new DOMException("aborted", "AbortError");
      },
    }),
    "REQUEST_ABORTED"
  );
});

test("maps network failures without forwarding a potentially sensitive cause", async () => {
  await expectCode(
    verifyZoteroApiKey(API_KEY, {
      fetchImpl: async () => {
        throw new Error(`request with ${API_KEY} failed`);
      },
    }),
    "NETWORK_ERROR"
  );
});

test("requires both personal-library read and write permissions", async () => {
  for (const user of [
    { library: false, write: true },
    { library: true, write: false },
    { library: true },
  ]) {
    await expectCode(
      verifyZoteroApiKey(API_KEY, {
        fetchImpl: async () => response(200, { userID: 123, access: { user } }),
      }),
      "INSUFFICIENT_PERMISSIONS"
    );
  }
});

test("rejects malformed JSON and invalid user IDs", async () => {
  await expectCode(
    verifyZoteroApiKey(API_KEY, {
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        json: async () => {
          throw new SyntaxError("bad JSON");
        },
      }),
    }),
    "INVALID_RESPONSE"
  );

  for (const userID of [null, 0, -1, 12.5, "01", "abc", Number.MAX_SAFE_INTEGER + 1]) {
    await expectCode(
      verifyZoteroApiKey(API_KEY, {
        fetchImpl: async () => response(200, {
          userID,
          access: { user: { library: true, write: true } },
        }),
      }),
      "INVALID_RESPONSE"
    );
  }
});

test("maps other non-success responses to a stable HTTP error", async () => {
  await assert.rejects(
    verifyZoteroApiKey(API_KEY, { fetchImpl: async () => response(503, null) }),
    (error) => {
      assert.strictEqual(error.code, "HTTP_ERROR");
      assert.strictEqual(error.status, 503);
      assert.doesNotMatch(error.message, new RegExp(API_KEY));
      return true;
    }
  );
});
