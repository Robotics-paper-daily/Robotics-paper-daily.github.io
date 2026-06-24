// Pure date logic for the report calendar popover (no DOM). `reports` is the
// reports.json array of filenames like "2026_06_13.html". Dual export: attaches
// to window.PRCalendar (the shell) and module.exports (node tests).
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.PRCalendar = api;
})(typeof window !== "undefined" ? window : null, function () {
  const FILE_RE = /^(\d{4})_(\d{2})_(\d{2})\.html$/;

  function parse(file) {
    const m = FILE_RE.exec(file);
    if (!m) return null;
    return { file, year: +m[1], month0: +m[2] - 1, day: +m[3], key: `${m[1]}-${m[2]}-${m[3]}` };
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // "YYYY-MM-DD" -> filename. Malformed entries are skipped; duplicate dates
  // collapse (last wins).
  function reportDateMap(reports) {
    const map = new Map();
    for (const f of reports || []) {
      const p = parse(f);
      if (p) map.set(p.key, f);
    }
    return map;
  }

  // The newest report by date (independent of input order). null if none.
  function latestReport(reports) {
    let best = null;
    for (const f of reports || []) {
      const p = parse(f);
      if (p && (!best || p.key > best.key)) best = p;
    }
    return best ? { key: best.key, file: best.file, year: best.year, month0: best.month0, day: best.day } : null;
  }

  // Unique {year, month0} that have at least one report, sorted ascending — used
  // for month-nav bounds.
  function monthsWithReports(reports) {
    const seen = new Set();
    const out = [];
    for (const f of reports || []) {
      const p = parse(f);
      if (!p) continue;
      const k = p.year * 12 + p.month0;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ year: p.year, month0: p.month0 });
    }
    out.sort((a, b) => a.year * 12 + a.month0 - (b.year * 12 + b.month0));
    return out;
  }

  // Sunday-start weeks covering the whole month, padded with adjacent-month spill
  // cells. Each cell: { day, key, inMonth, file|null }.
  function monthMatrix(year, month0, dateMap) {
    const startDow = new Date(year, month0, 1).getDay(); // 0 = Sun
    const daysInMonth = new Date(year, month0 + 1, 0).getDate();
    const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
    const weeks = [];
    let week = [];
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(year, month0, 1 - startDow + i);
      const y = d.getFullYear();
      const mo = d.getMonth();
      const day = d.getDate();
      const key = `${y}-${pad2(mo + 1)}-${pad2(day)}`;
      week.push({
        day,
        key,
        inMonth: y === year && mo === month0,
        file: (dateMap && dateMap.get(key)) || null,
      });
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    return weeks;
  }

  return { reportDateMap, latestReport, monthsWithReports, monthMatrix };
});
