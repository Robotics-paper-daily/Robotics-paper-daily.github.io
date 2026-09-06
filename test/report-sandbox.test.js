const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  LOCAL_REPORT_SCRIPTS,
  isAllowedReportFrameUrl,
  prepareAppReportHtml,
  reportContentSecurityPolicy,
  stripRemoteCssImports,
} = require("../app/report-sandbox");

function hostileReport() {
  const papers = [
    {
      title: "<img src=x onerror=steal()>& paper",
      url: "https://arxiv.org/abs/2608.01201v1",
      authors: ["A"],
    },
  ];
  return `<!doctype html>
    <html><head>
      <base href="https://evil.example/">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css">
      <style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap'); :root { --source-marker: #123456; } .sentinel { color: red; }</style>
      <script src="https://cdn.tailwindcss.com"></script>
      <script>window.parent.postMessage({channel:'paperreader-report-v1'}, '*')</script>
    </head><body onload="steal()">
      <motion.div class="header"><h1>Report</h1></motion.div>
      <div class="paper-rating">
        <i class="fas fa-star"></i>
        <i class="fas fa-star-half-alt"></i>
        <i class="far fa-star"></i>
      </div>
      <a class="paper-link"><i class="fas fa-file-pdf mr-1"></i>PDF</a>
      <button class="translate-btn"><i class="fas fa-language"></i>Translate</button>
      <a class="filtered-item-title-link"><i class="fas fa-up-right-from-square" title="Open externally"></i></a>
      <script type="application/json" id="papers-data">${JSON.stringify(papers)}</script>
      <script src="../js/zotero.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/jszip/dist/jszip.min.js"></script>
    </body></html>`;
}

test("app report transform removes source code and injects only nonce-bound local scripts", () => {
  const nonce = "a".repeat(32);
  const prepared = prepareAppReportHtml(hostileReport(), { nonce });
  const html = prepared.body.toString("utf8");

  assert.strictEqual(prepared.paperCount, 1);
  assert.doesNotMatch(html, /cdn\.tailwindcss|cdn\.jsdelivr|window\.parent\.postMessage|<base\b/i);
  assert.doesNotMatch(html, /font-awesome|fontawesome/i);
  assert.doesNotMatch(html, /src="\.\.\/js\/zotero\.js"/);
  assert.match(html, /id="papers-data" type="application\/json" nonce="a{32}"/);
  assert.match(html, /\\u003cimg src=x onerror=steal\(\)\\u003e\\u0026 paper/);

  const executable = [...html.matchAll(/<script\b([^>]*)>/gi)];
  assert.strictEqual(executable.length, LOCAL_REPORT_SCRIPTS.length + 1);
  for (const src of LOCAL_REPORT_SCRIPTS) {
    assert.match(html, new RegExp(`nonce="${nonce}" src="${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.ok(executable.every((match) => match[1].includes(`nonce="${nonce}"`)));
});

test("legacy report webfont icons become semantic-layout-preserving inline SVG", () => {
  const html = prepareAppReportHtml(hostileReport(), { nonce: "d".repeat(32) }).body.toString(
    "utf8"
  );

  for (const name of ["star", "star-half", "star-outline", "pdf", "language", "external"]) {
    assert.match(html, new RegExp(`data-report-icon="${name}"`), name);
  }
  assert.match(html, /class="report-icon report-icon-pdf mr-1"/);
  assert.match(html, /data-report-icon="external"[^>]+role="img" aria-label="Open externally"/);
  assert.match(html, /id="paperreader-report-icon-styles"/);
  assert.doesNotMatch(html, /<i\b/i);
  assert.doesNotMatch(html, /\b(?:fas|far|fab|fa-(?:star|star-half-alt|file-pdf|language|up-right-from-square))\b/i);
});

test("app report gets one fluid, compositor-stable UI layer", () => {
  const nonce = "e".repeat(32);
  const first = prepareAppReportHtml(hostileReport(), { nonce }).body.toString("utf8");
  const second = prepareAppReportHtml(first, { nonce }).body.toString("utf8");

  for (const html of [first, second]) {
    assert.strictEqual((html.match(/id="paperreader-report-ui-styles"/g) || []).length, 1);
    assert.strictEqual((html.match(/id="paperreader-report-icon-styles"/g) || []).length, 1);
    assert.doesNotMatch(html, /@import\s+[^;]*(?:fonts\.googleapis|https?:\/\/)/i);
    assert.doesNotMatch(html, /600;700&display=swap/);
    assert.match(html, /:root\s*\{\s*--source-marker:\s*#123456/);
    assert.doesNotMatch(html, /<\/?motion\.div\b/i);
    assert.match(html, /body\{[\s\S]*max-width:1680px!important[\s\S]*margin:0 auto!important/);
    assert.match(html, /--report-action-icon-size:18px/);
    assert.match(html, /--highlight-primary:#7b2c9f/);
    assert.match(html, /\.zotero-btn\.saved\{[\s\S]*var\(--highlight-primary,#7b2c9f\)/);
    assert.match(html, /--report-action-height:42px/);
    assert.match(html, /--report-compact-icon-size:16px/);
    assert.match(html, /--report-compact-height:36px/);
    assert.match(html, /backdrop-filter:none!important/);
    assert.match(html, /\.bento-item:hover\{[\s\S]*transform:none!important/);
    assert.match(html, /\.filtered-item h3::after\{content:"";order:2;flex-basis:100%/);
    assert.match(html, /@media \(max-width:720px\)/);
    assert.match(html, /width:calc\(50% - \.75rem\)/);
    assert.match(html, /margin:\.5rem \.45rem 0 0!important/);
    assert.match(html, /@media \(max-width:560px\)/);
  }
});

test("remote CSS import removal consumes semicolons inside quoted font URLs", () => {
  const source = `<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
    :root { --highlight-primary: #7B2C9F; }
    .saved { color: white; }
  </style>`;
  const html = stripRemoteCssImports(source);

  assert.doesNotMatch(html, /fonts\.googleapis|@import|600;700/);
  assert.match(html, /:root\s*\{\s*--highlight-primary:\s*#7B2C9F/);
  assert.match(html, /\.saved\s*\{\s*color:\s*white/);
});

test("runtime report actions keep stable local SVG sizing without opacity pulsing", () => {
  const readPaper = fs.readFileSync(path.join(__dirname, "..", "js", "read-paper.js"), "utf8");
  const like = fs.readFileSync(path.join(__dirname, "..", "js", "like.js"), "utf8");
  const shell = fs.readFileSync(path.join(__dirname, "..", "app", "shell.html"), "utf8");

  assert.match(readPaper, /--report-action-icon-size,18px/);
  assert.match(readPaper, /--report-compact-icon-size,16px/);
  assert.match(readPaper, /--report-action-height,42px/);
  assert.match(readPaper, /--report-compact-height,36px/);
  assert.doesNotMatch(readPaper, /read-pulse|max-width:1400px/);
  assert.doesNotMatch(readPaper, /<i\b|fa-spinner|fa-wand|fa-circle-check/);
  assert.match(like, /#zotero-sync-status \.zotero-svg-icon\{width:16px;height:16px\}/);
  assert.doesNotMatch(like, /<i\b|fa-spinner|fa-circle-check|fa-triangle-exclamation/);
  assert.match(shell, /\.sr-btn\s*\{[\s\S]*?min-height:\s*36px/);
  assert.match(shell, /\.sr-btn svg\s*\{\s*width:\s*16px;\s*height:\s*16px/);
});

test("report CSP blocks untrusted execution and active embedding surfaces", () => {
  const nonce = "b".repeat(32);
  const csp = reportContentSecurityPolicy(nonce);
  assert.match(csp, new RegExp(`script-src 'nonce-${nonce}'`));
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /worker-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.doesNotMatch(csp, /script-src[^;]*https:/);
});

test("every report response gets a fresh nonce", () => {
  const first = prepareAppReportHtml(hostileReport());
  const second = prepareAppReportHtml(hostileReport());
  assert.match(first.nonce, /^[a-f0-9]{32}$/);
  assert.match(second.nonce, /^[a-f0-9]{32}$/);
  assert.notStrictEqual(first.nonce, second.nonce);
  assert.notStrictEqual(first.csp, second.csp);
});

test("report frame navigation accepts only the exact app daily-report shape", () => {
  assert.strictEqual(
    isAllowedReportFrameUrl(
      "app://local/site/daily_html/2026_08_03.html?app=1&zotero=1"
    ),
    true
  );
  assert.strictEqual(
    isAllowedReportFrameUrl(
      "app://local/site/daily_html/2026_08_03.html?zotero=0&app=1"
    ),
    true
  );
  for (const url of [
    "https://evil.example/?app=1&zotero=1",
    "app://evil/site/daily_html/2026_08_03.html?app=1&zotero=1",
    "app://local/site/daily_html/../../shell.html?app=1&zotero=1",
    "app://local/site/daily_html/2026-08-03.html?app=1&zotero=1",
    "app://local/site/daily_html/2026_08_03.html?app=1&zotero=1&extra=1",
    "app://local/site/daily_html/2026_08_03.html?app=1&app=1&zotero=1",
    "app://local/site/daily_html/2026_08_03.html?app=1&zotero=2",
    "app://local/site/daily_html/2026_08_03.html?app=1&zotero=1#x",
  ]) {
    assert.strictEqual(isAllowedReportFrameUrl(url), false, url);
  }
});

test("missing, duplicated, malformed, and non-array papers data fail closed", () => {
  assert.throws(() => prepareAppReportHtml("<html></html>"), /missing #papers-data/);
  assert.throws(
    () => prepareAppReportHtml(
      '<script id="papers-data" type="application/json">[]</script>' +
        '<script id="papers-data" type="application/json">[]</script>'
    ),
    /duplicate/
  );
  assert.throws(
    () => prepareAppReportHtml('<script id="papers-data" type="application/json">{</script>'),
    /invalid/
  );
  assert.throws(
    () => prepareAppReportHtml('<script id="papers-data" type="application/json">{}</script>'),
    /JSON array/
  );
});

test("a real bundled daily report survives hardening without remote executable code", () => {
  const latest = fs
    .readdirSync(path.join(__dirname, "..", "daily_html"))
    .filter((name) => /^\d{4}_\d{2}_\d{2}\.html$/.test(name))
    .sort()
    .at(-1);
  const source = fs.readFileSync(path.join(__dirname, "..", "daily_html", latest));
  const prepared = prepareAppReportHtml(source, { nonce: "c".repeat(32) });
  const html = prepared.body.toString("utf8");
  assert.ok(prepared.paperCount > 0);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.match(html, /app:\/\/local\/site\/js\/app-rpc\.js/);
  assert.match(html, /app:\/\/local\/site\/js\/like\.js/);
  assert.match(html, /app:\/\/local\/site\/js\/read-paper\.js/);
  // Which icon kinds appear varies with each day's generated content (some
  // days ship no ratings or PDF chips), so assert the stable pair plus the
  // inline-icon mechanism instead of pinning a day-specific icon set.
  assert.match(html, /data-report-icon="language"/);
  assert.match(html, /data-report-icon="external"/);
  assert.doesNotMatch(html, /font-awesome|fontawesome/i);
  assert.doesNotMatch(html, /<i\b[^>]*\b(?:fas|far|fab|fa-[a-z0-9-]+)\b/i);
});

test("future report template emits inline icons without a Font Awesome dependency", () => {
  const template = fs.readFileSync(
    path.join(__dirname, "..", "templates", "paper_template.html"),
    "utf8"
  );
  assert.match(template, /<svg class="report-icon report-icon-\{\{ name \}\}/);
  for (const name of ["star", "star-half", "star-outline", "pdf", "language", "external"]) {
    assert.match(template, new RegExp(`report_icon\\('${name}'`), name);
  }
  assert.doesNotMatch(template, /font-awesome|fontawesome/i);
  assert.doesNotMatch(template, /<i\b|\b(?:fas|far|fab|fa-[a-z0-9-]+)\b/i);
});
