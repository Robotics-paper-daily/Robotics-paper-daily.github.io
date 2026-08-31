// Turns a live daily-report HTML document into inert data plus a very small,
// packaged interaction layer. The source document is fetched from the public
// website and must never be allowed to choose executable code inside Electron.

"use strict";

const crypto = require("crypto");

const LOCAL_REPORT_SCRIPTS = Object.freeze([
  "app://local/site/js/app-rpc.js",
  "app://local/site/js/like.js",
  "app://local/site/js/translate.js",
  "app://local/site/js/read-paper.js",
]);

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const OPENING_SCRIPT_RE = /^<script\b([^>]*)>/i;
const ICON_ELEMENT_RE = /<i\b([^>]*)>\s*<\/i\s*>/gi;

// Daily reports published before v0.3.0 used Font Awesome webfonts. The App's
// report CSP intentionally sets `font-src 'none'`, so those glyphs rendered as
// empty boxes. Keep the CSP strict and translate the small, known icon surface
// into self-contained SVG instead.
const REPORT_ICON_STYLE = `<style id="paperreader-report-icon-styles">
.report-icon{display:inline-block;width:1em;height:1em;vertical-align:-.125em;overflow:visible;fill:currentColor;flex:0 0 auto}
.paper-rating .report-icon,.paper-sub-ratings .report-icon{margin-right:.125rem}
.paper-sub-ratings .report-icon{color:#f59e0b}
.paper-link .report-icon{margin-right:.5rem;transition:transform .18s ease}
.paper-link:hover .report-icon{transform:translateX(2px)}
.translate-btn .report-icon{transition:transform .18s ease}
.translate-btn:hover .report-icon{transform:scale(1.18) translateX(1px)}
.filtered-item-title-link .report-icon{font-size:.8rem;opacity:.8}
</style>`;

// Tailwind is deliberately stripped from App reports, so its container,
// spacing and antialiasing utility classes do not exist inside Electron. Keep
// the report layout self-contained and fluid across the full supported App
// window range. This style is injected after the report's own CSS so it also
// repairs cached and historical reports without redeploying them.
const REPORT_UI_STYLE = `<style id="paperreader-report-ui-styles">
:root{
  /* App-owned theme fallbacks. Historical reports may omit these variables,
     and malformed remote-font imports must never make a saved action render
     as white content on a transparent card. */
  --bg-color:#f8fafc;
  --card-bg-color:#fff;
  --text-color:#1e293b;
  --text-muted-color:#64748b;
  --header-color:#0f172a;
  --highlight-primary:#7b2c9f;
  --highlight-secondary:#b794d3;
  --border-color:#e2e8f0;
  --shadow-color:rgba(15,23,42,.08);
  --report-page-gutter:clamp(12px,1.25vw,20px);
  --report-card-padding:clamp(18px,2.1vw,28px);
  --report-grid-gap:clamp(16px,1.5vw,24px);
  --report-action-icon-size:18px;
  --report-action-height:42px;
  --report-compact-icon-size:16px;
  --report-compact-height:36px;
}
html{min-width:0;background:#f8fafc}
*,*::before,*::after{box-sizing:border-box}
body{
  width:100%!important;
  max-width:1680px!important;
  min-width:0;
  margin:0 auto!important;
  padding-left:var(--report-page-gutter)!important;
  padding-right:var(--report-page-gutter)!important;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif!important;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
.header{display:block;padding-top:clamp(28px,4vw,48px);margin-bottom:clamp(32px,4vw,48px)}
.header h1{font-size:clamp(1.75rem,1.35rem + 1.35vw,2.5rem)}
.line-graphic{width:25%;margin:1rem auto 2rem}
.text-xs{font-size:.75rem;line-height:1rem}
.text-gray-500{color:#6b7280}
.ml-1{margin-left:.25rem}
.col-span-full{grid-column:1/-1}
.text-center{text-align:center}
.bento-grid{gap:var(--report-grid-gap)}
.bento-item{
  min-width:0;
  padding:var(--report-card-padding);
  background:#fff!important;
  -webkit-backdrop-filter:none!important;
  backdrop-filter:none!important;
  transform:none!important;
  transition:box-shadow .18s ease,border-color .18s ease,background-color .18s ease!important;
}
.bento-item:hover{
  transform:none!important;
  border-color:rgba(183,148,211,.7);
  box-shadow:0 10px 22px rgba(15,23,42,.11),0 3px 8px rgba(15,23,42,.05);
}
.paper-title{font-size:clamp(1rem,.8rem + .35vw,1.125rem)}
.filtered-item{padding:clamp(.85rem,1.6vw,1.25rem);background:#fff!important}
.filtered-item h3{display:flex;flex-wrap:wrap;align-items:center;column-gap:.4rem;min-width:0}
.filtered-item-title-link{order:1;flex:1 1 320px;min-width:0}
.filtered-item h3>.topic-chip{order:1}
.filtered-item h3::after{content:"";order:2;flex-basis:100%;width:0;height:0}
.filtered-item h3>:is(.translate-btn-compact,.zotero-btn-compact,.read-btn-compact){order:3}
.bento-item>:is(.paper-link,.translate-btn,.zotero-btn,.read-btn){
  box-sizing:border-box;
  min-height:var(--report-action-height);
  margin:.4rem .45rem 0 0!important;
  padding:.55rem .95rem;
  gap:.5rem;
  line-height:1.25;
  white-space:nowrap;
  vertical-align:middle;
}
.paper-link>.report-icon,.translate-btn>.report-icon,
.zotero-btn>.zotero-icon,.read-btn>.read-icon{
  width:var(--report-action-icon-size)!important;
  height:var(--report-action-icon-size)!important;
  flex:0 0 var(--report-action-icon-size);
}
.paper-link>.report-icon{margin-right:0!important}
.zotero-btn.saved{
  color:#fff!important;
  background:linear-gradient(135deg,var(--highlight-primary,#7b2c9f),var(--highlight-secondary,#b794d3))!important;
  border-color:transparent!important;
}
:is(.translate-btn-compact,.zotero-btn-compact,.read-btn-compact){
  box-sizing:border-box;
  min-height:var(--report-compact-height)!important;
  margin:.3rem .4rem 0 0!important;
  padding:.42rem .72rem!important;
  line-height:1.2;
}
.translate-btn-compact>.report-icon,
.zotero-btn-compact>.zotero-icon,
.read-btn-compact>.read-icon{
  width:var(--report-compact-icon-size)!important;
  height:var(--report-compact-icon-size)!important;
  flex-basis:var(--report-compact-icon-size);
}
.read-mark-toggle{box-sizing:border-box;min-height:var(--report-compact-height);line-height:1.2}
.read-mark-toggle>.read-svg-icon{width:var(--report-compact-icon-size)!important;height:var(--report-compact-icon-size)!important;flex:0 0 var(--report-compact-icon-size)}
.read-mark-badge>.read-svg-icon{width:14px!important;height:14px!important}
@media (max-width:720px){
  .header{padding-top:1.75rem;margin-bottom:2rem}
  .bento-item>:is(.paper-link,.translate-btn,.zotero-btn,.read-btn){
    /* Leave room for inline whitespace as well as the visual gutter so two
       controls reliably share a row in cached reports without an action
       wrapper element. */
    width:calc(50% - .75rem);
    margin:.5rem .45rem 0 0!important;
    justify-content:center;
  }
}
@media (max-width:560px){
  .bento-item>:is(.paper-link,.translate-btn,.zotero-btn,.read-btn){width:100%;margin-right:0!important}
}
@media (prefers-reduced-motion:reduce){
  .bento-item,.paper-link,.translate-btn,.zotero-btn,.read-btn,.report-icon,.read-svg-icon,.zotero-svg-icon{animation:none!important;transition:none!important}
}
</style>`;

const ICON_ALIASES = Object.freeze({
  "fa-file-pdf": "pdf",
  "fa-language": "language",
  "fa-up-right-from-square": "external",
  "fa-arrow-up-right-from-square": "external",
  "fa-external-link": "external",
  "fa-external-link-alt": "external",
  "fa-star-half-alt": "star-half",
  "fa-star-half-stroke": "star-half",
});

function attributeValue(attributes, name) {
  const match = String(attributes || "").match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`, "i")
  );
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : "";
}

function safeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function reportIconSvg(name, extraClasses = [], accessibleName = "") {
  const className = ["report-icon", `report-icon-${name}`, ...extraClasses]
    .filter(Boolean)
    .join(" ");
  const accessibility = accessibleName
    ? `role="img" aria-label="${escapeHtmlAttribute(accessibleName)}"`
    : 'aria-hidden="true" focusable="false"';
  const paths = {
    star: '<path d="M12 2.6l2.82 5.72 6.31.92-4.56 4.45 1.08 6.28L12 17l-5.65 2.97 1.08-6.28-4.56-4.45 6.31-.92z"/>',
    "star-outline": '<path d="M12 2.6l2.82 5.72 6.31.92-4.56 4.45 1.08 6.28L12 17l-5.65 2.97 1.08-6.28-4.56-4.45 6.31-.92z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    "star-half": '<path d="M12 2.6V17l-5.65 2.97 1.08-6.28-4.56-4.45 6.31-.92z"/><path d="M12 2.6l2.82 5.72 6.31.92-4.56 4.45 1.08 6.28L12 17l-5.65 2.97 1.08-6.28-4.56-4.45 6.31-.92z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    pdf: '<path d="M7 2.5h7l4 4v15H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 2.5v4h4M9.2 17.8v-5.6h1.65a1.75 1.75 0 010 3.5H9.2m5.1 2.1v-5.6h1.25c1.5 0 2.45 1.05 2.45 2.8s-.95 2.8-2.45 2.8z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>',
    language: '<path d="M3 5h9M7.5 3v2m3.5 0c-.8 3.7-3.4 6.5-7 7.5m1-5c1.2 2 3.1 3.7 5.4 4.7M13 20l3.2-8h1.6l3.2 8m-7-3h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    external: '<path d="M13 5h6v6m0-6-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 13v5a1 1 0 01-1 1H6a1 1 0 01-1-1V8a1 1 0 011-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    unknown: '<circle cx="12" cy="12" r="3"/>',
  };
  return `<svg class="${escapeHtmlAttribute(className)}" data-report-icon="${escapeHtmlAttribute(
    name
  )}" viewBox="0 0 24 24" ${accessibility}>${paths[name] || paths.unknown}</svg>`;
}

function replaceFontAwesomeIcons(input) {
  return String(input || "").replace(ICON_ELEMENT_RE, (element, attributes) => {
    const classes = attributeValue(attributes, "class").split(/\s+/).filter(Boolean);
    const hasFontAwesomeClass = classes.some(
      (token) => /^(?:fa[brs]?|fa-(?:solid|regular|brands|light|thin|duotone)|fa-[a-z0-9-]+)$/i.test(token)
    );
    if (!hasFontAwesomeClass) return element;

    const regular = classes.some((token) => /^(?:far|fa-regular)$/i.test(token));
    let name = "unknown";
    if (classes.includes("fa-star")) name = regular ? "star-outline" : "star";
    else {
      const aliased = classes.find((token) => ICON_ALIASES[token.toLowerCase()]);
      if (aliased) name = ICON_ALIASES[aliased.toLowerCase()];
    }
    const extraClasses = classes.filter(
      (token) => !/^(?:fa[brs]?|fa-(?:solid|regular|brands|light|thin|duotone)|fa-[a-z0-9-]+)$/i.test(token)
    );
    const accessibleName = attributeValue(attributes, "aria-label") || attributeValue(attributes, "title");
    return reportIconSvg(name, extraClasses, accessibleName);
  });
}

function stripFontAwesomeStylesheets(input) {
  return String(input || "").replace(/<link\b[^>]*>/gi, (tag) => {
    const href = attributeValue(tag, "href").toLowerCase();
    return /(?:font-awesome|fontawesome)/.test(href) ? "" : tag;
  });
}

function cssImportRuleEnd(css, start) {
  let quote = "";
  let escaped = false;
  let parentheses = 0;
  for (let index = start; index < css.length; index += 1) {
    const char = css[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") parentheses += 1;
    else if (char === ")" && parentheses > 0) parentheses -= 1;
    else if (char === ";" && parentheses === 0) return index + 1;
  }
  return -1;
}

function stripRemoteImportsFromCss(input) {
  const css = String(input || "");
  const importPattern = /@import\b/gi;
  let output = "";
  let cursor = 0;
  let match;
  while ((match = importPattern.exec(css))) {
    output += css.slice(cursor, match.index);
    const end = cssImportRuleEnd(css, match.index);
    if (end < 0) {
      output += css.slice(match.index);
      cursor = css.length;
      break;
    }
    const rule = css.slice(match.index, end);
    if (!/^@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//i.test(rule)) {
      output += rule;
    }
    cursor = end;
    importPattern.lastIndex = end;
  }
  return output + css.slice(cursor);
}

function stripRemoteCssImports(input) {
  return String(input || "").replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_tag, opening, css, closing) => `${opening}${stripRemoteImportsFromCss(css)}${closing}`
  );
}

function normalizeInertMotionElements(input) {
  return String(input || "")
    .replace(/<motion\.div\b/gi, "<div")
    .replace(/<\/motion\.div\s*>/gi, "</div>");
}

function injectReportStyles(input) {
  // Never let report-provided markup suppress or shadow the authoritative App
  // styles. Removing an earlier transform's copies also keeps the operation
  // idempotent for cache recovery and tests.
  const html = String(input || "").replace(
    /<style\b[^>]*\bid\s*=\s*["']paperreader-report-(?:icon|ui)-styles["'][^>]*>[\s\S]*?<\/style\s*>/gi,
    ""
  );
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, `${REPORT_ICON_STYLE}\n${REPORT_UI_STYLE}\n</head>`);
  }
  return `${REPORT_ICON_STYLE}\n${REPORT_UI_STYLE}\n${html}`;
}

function extractPapersData(html) {
  let papers = null;
  for (const match of String(html || "").matchAll(SCRIPT_RE)) {
    const opening = match[0].match(OPENING_SCRIPT_RE);
    if (!opening) continue;
    const attributes = opening[1];
    if (attributeValue(attributes, "id") !== "papers-data") continue;
    if (attributeValue(attributes, "type").toLowerCase() !== "application/json") {
      throw new Error("#papers-data must use application/json");
    }
    if (papers !== null) throw new Error("daily report contains duplicate #papers-data blocks");
    const start = opening[0].length;
    const end = match[0].search(/<\/script\s*>\s*$/i);
    let parsed;
    try {
      parsed = JSON.parse(match[0].slice(start, end));
    } catch (cause) {
      throw new Error("daily report contains invalid #papers-data JSON", { cause });
    }
    if (!Array.isArray(parsed)) throw new Error("#papers-data must be a JSON array");
    papers = parsed;
  }
  if (papers === null) throw new Error("daily report is missing #papers-data");
  return papers;
}

function reportContentSecurityPolicy(nonce) {
  if (!/^[a-f0-9]{32}$/i.test(nonce || "")) throw new Error("invalid report CSP nonce");
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    "img-src https: data:",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src https:",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function isAllowedReportFrameUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const keys = [...url.searchParams.keys()];
  if (
    url.protocol !== "app:" ||
    url.hostname !== "local" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/site\/daily_html\/\d{4}_\d{2}_\d{2}\.html$/.test(url.pathname) ||
    url.searchParams.get("app") !== "1" ||
    !["0", "1"].includes(url.searchParams.get("zotero")) ||
    keys.length !== 2 ||
    new Set(keys).size !== 2 ||
    !keys.every((key) => key === "app" || key === "zotero")
  ) {
    return false;
  }
  return true;
}

function prepareAppReportHtml(input, options = {}) {
  const source = Buffer.isBuffer(input) ? input.toString("utf8") : String(input || "");
  const papers = extractPapersData(source);
  const nonce = options.nonce || crypto.randomBytes(16).toString("hex");
  const csp = reportContentSecurityPolicy(nonce);

  // CSP is the security boundary; stripping scripts as well keeps the DOM free
  // of dormant third-party code and avoids unnecessary CDN requests/noise.
  let html = source.replace(SCRIPT_RE, "");
  html = html.replace(/<base\b[^>]*>/gi, "");
  html = stripFontAwesomeStylesheets(html);
  html = stripRemoteCssImports(html);
  html = normalizeInertMotionElements(html);
  html = replaceFontAwesomeIcons(html);
  html = injectReportStyles(html);

  const scripts = [
    `<script id="papers-data" type="application/json" nonce="${nonce}">${safeJsonForHtml(papers)}</script>`,
    ...LOCAL_REPORT_SCRIPTS.map(
      (src) => `<script nonce="${nonce}" src="${src}"></script>`
    ),
  ].join("\n");

  if (/<\/body\s*>/i.test(html)) {
    html = html.replace(/<\/body\s*>/i, `${scripts}\n</body>`);
  } else {
    html += `\n${scripts}`;
  }

  return {
    body: Buffer.from(html, "utf8"),
    csp,
    nonce,
    paperCount: papers.length,
  };
}

module.exports = {
  LOCAL_REPORT_SCRIPTS,
  extractPapersData,
  isAllowedReportFrameUrl,
  prepareAppReportHtml,
  replaceFontAwesomeIcons,
  reportContentSecurityPolicy,
  reportIconSvg,
  safeJsonForHtml,
  stripRemoteCssImports,
  normalizeInertMotionElements,
};
