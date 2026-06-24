const test = require("node:test");
const assert = require("node:assert");
const cal = require("../app/calendar");

test("reportDateMap maps date keys to files and skips malformed", () => {
  const m = cal.reportDateMap([
    "2026_06_13.html",
    "2026_06_10.html",
    "garbage.html",
    "2026_06_13.html",
  ]);
  assert.strictEqual(m.get("2026-06-13"), "2026_06_13.html");
  assert.strictEqual(m.get("2026-06-10"), "2026_06_10.html");
  assert.strictEqual(m.has("garbage"), false);
  assert.strictEqual(m.size, 2);
});

test("latestReport returns the newest date regardless of input order", () => {
  const r = cal.latestReport(["2026_06_10.html", "2026_06_13.html", "2026_05_30.html"]);
  assert.deepStrictEqual(r, {
    key: "2026-06-13",
    file: "2026_06_13.html",
    year: 2026,
    month0: 5,
    day: 13,
  });
  assert.strictEqual(cal.latestReport([]), null);
});

test("monthsWithReports lists unique year/month sorted ascending", () => {
  const ms = cal.monthsWithReports([
    "2026_06_13.html",
    "2026_05_30.html",
    "2026_06_01.html",
    "2025_12_31.html",
  ]);
  assert.deepStrictEqual(ms, [
    { year: 2025, month0: 11 },
    { year: 2026, month0: 4 },
    { year: 2026, month0: 5 },
  ]);
});

test("monthMatrix builds a Sunday-start grid for June 2026", () => {
  const map = cal.reportDateMap(["2026_06_13.html", "2026_06_01.html"]);
  const weeks = cal.monthMatrix(2026, 5, map);
  for (const w of weeks) assert.strictEqual(w.length, 7);
  // June 1 2026 is a Monday → column 1; column 0 is May 31 (out of month).
  assert.deepStrictEqual(weeks[0][0], { day: 31, key: "2026-05-31", inMonth: false, file: null });
  assert.deepStrictEqual(weeks[0][1], { day: 1, key: "2026-06-01", inMonth: true, file: "2026_06_01.html" });
  // June 13 sits at week 1, Saturday (col 6); it has a report.
  assert.deepStrictEqual(weeks[1][6], { day: 13, key: "2026-06-13", inMonth: true, file: "2026_06_13.html" });
  // A June day with no report has file null.
  assert.deepStrictEqual(weeks[0][2], { day: 2, key: "2026-06-02", inMonth: true, file: null });
  const inMonth = weeks.flat().filter((c) => c.inMonth).length;
  assert.strictEqual(inMonth, 30);
});
