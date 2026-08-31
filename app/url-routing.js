"use strict";

function classifyOpenUrl(value) {
  if (typeof value !== "string" || !value) return "deny";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? "web" : "deny";
  } catch {
    return "deny";
  }
}

module.exports = { classifyOpenUrl };
