// Narrow report-frame RPC used by the PaperReader desktop app.
//
// Reports can run in a sandboxed, unique-origin iframe, so they must not reach
// into `window.top` for the Electron preload bridge. The shell owns that bridge
// and answers this small postMessage protocol instead. On the public website
// `app=1` is absent and requests fail closed without sending privileged work.

(function () {
  "use strict";

  const CHANNEL = "paperreader-report-v1";
  const params = new URLSearchParams(window.location.search || "");
  const appEnabled = params.get("app") === "1";
  const zoteroEnabled = appEnabled && params.get("zotero") === "1";
  const pending = new Map();
  const progressSubscribers = new Set();
  let sequence = 0;
  const reportFile = (window.location.pathname || "").split("/").pop() || "";

  function nextId() {
    sequence += 1;
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return `report-${window.crypto.randomUUID()}`;
      }
    } catch {}
    return `report-${Date.now().toString(36)}-${sequence.toString(36)}`;
  }

  function timeoutFor(method) {
    // Zotero binding scans every top-level item with pagination, while Add may
    // wait for a large PDF download plus OneDrive File Provider confirmation.
    // A report-level wall timeout can therefore announce failure immediately
    // before a valid read/write finishes. Each underlying network/cloud stage
    // is independently bounded, and navigation destroys this frame's pending
    // promises naturally.
    if (
      [
        "paper:read",
        "vault:openNote",
        "vault:setReadStatus",
        "job:openInObsidian",
        "zotero:list",
        "zotero:add",
        "zotero:remove",
      ].includes(method)
    ) {
      return 0;
    }
    return 30 * 1000;
  }

  function transportError(value) {
    const detail = value && typeof value === "object" ? value : {};
    const error = new Error(
      typeof value === "string"
        ? value
        : typeof detail.message === "string"
          ? detail.message
          : "PaperReader shell request failed"
    );
    if (typeof detail.code === "string") error.code = detail.code;
    return error;
  }

  function post(message) {
    window.parent.postMessage(message, "*");
  }

  function request(method, payload) {
    if (!appEnabled) {
      return Promise.reject(transportError({ code: "APP_UNAVAILABLE", message: "PaperReader app bridge is unavailable" }));
    }
    if (typeof method !== "string" || !method) {
      return Promise.reject(transportError({ code: "INVALID_METHOD", message: "RPC method must be a non-empty string" }));
    }

    const id = nextId();
    return new Promise((resolve, reject) => {
      const timeoutMs = timeoutFor(method);
      const timer = timeoutMs
        ? setTimeout(() => {
            pending.delete(id);
            reject(transportError({ code: "RPC_TIMEOUT", message: `PaperReader request timed out: ${method}` }));
          }, timeoutMs)
        : null;

      pending.set(id, { resolve, reject, timer });
      try {
        post({ channel: CHANNEL, type: "request", id, method, payload });
      } catch (error) {
        if (timer != null) clearTimeout(timer);
        pending.delete(id);
        reject(transportError(error));
      }
    });
  }

  function onProgress(callback) {
    if (typeof callback !== "function") return () => {};
    progressSubscribers.add(callback);
    return () => progressSubscribers.delete(callback);
  }

  window.addEventListener("message", (event) => {
    // `origin` is intentionally not used here: a sandboxed report has an opaque
    // origin. The WindowProxy identity plus the private channel/envelope is the
    // stable boundary between this frame and its direct shell parent.
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;

    if (message.type === "response" && typeof message.id === "string") {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (waiter.timer != null) clearTimeout(waiter.timer);
      if (message.ok) waiter.resolve(message.result);
      else waiter.reject(transportError(message.error));
      return;
    }

    if (message.type === "event" && message.event === "progress") {
      for (const callback of progressSubscribers) {
        try {
          callback(message.payload);
        } catch {}
      }
    }
  });

  const zoteroAdd = (paper) => request("zotero:add", { paper, reportFile });
  const zoteroRemove = (itemRef) => request("zotero:remove", { itemRef, reportFile });
  const zoteroList = (baseIds) => request("zotero:list", {
    baseIds: Array.isArray(baseIds) ? baseIds : [],
    reportFile,
  });
  const zotero = Object.freeze({
    isUnlocked: () => zoteroEnabled,
    add: zoteroAdd,
    remove: zoteroRemove,
    list: zoteroList,
    listDailyPaperArxivMap: zoteroList,
  });

  const bridge = Object.freeze({
    channel: CHANNEL,
    app: appEnabled,
    appEnabled,
    zoteroEnabled,
    request,
    read: (payload) => request("paper:read", payload),
    listJobs: () => request("job:list", { reportFile }),
    readPapers: (baseIds) => request("vault:readPapers", {
      baseIds: Array.isArray(baseIds) ? baseIds : [],
      reportFile,
    }),
    openNote: (noteRef) => request("vault:openNote", { noteRef, reportFile }),
    setReadStatus: (noteRef, read) => request("vault:setReadStatus", {
      noteRef,
      read: !!read,
      reportFile,
    }),
    openInObsidian: (jobId) => request("job:openInObsidian", { jobId, reportFile }),
    zoteroAdd,
    zoteroRemove,
    zoteroList,
    zotero,
    onProgress,
  });

  window.PaperReaderReportBridge = bridge;

  // Announces capabilities after the listener/bridge are ready. The shell may
  // use this to replay current job state after an iframe navigation.
  post({
    channel: CHANNEL,
    type: "event",
    event: "ready",
    payload: { app: appEnabled, zoteroEnabled },
  });
})();
