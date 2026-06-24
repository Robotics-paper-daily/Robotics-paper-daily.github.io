// Extract an arxiv id from user input, and parse the arXiv Atom API response
// into a paper-metadata object. Pure (no network) — the IPC handler in main.js
// does the fetch and calls parseArxivAtom on the body.

const NEW = /(\d{4}\.\d{4,5})(v\d+)?/;

function arxivIdFromInput(s) {
  if (!s) return null;
  let v = String(s).trim();
  const m = NEW.exec(v);
  if (m) return m[1] + (m[2] || "");
  // Old-style ids (e.g. hep-th/9901001): only accept when the input is just the
  // id or an arxiv abs/pdf URL of it — anchored, to avoid matching paper names.
  v = v.replace(/^arxiv:\s*/i, "").replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "");
  const o = /^([a-z][a-z.\-]*\/\d{7})(v\d+)?$/i.exec(v);
  return o ? o[1] + (o[2] || "") : null;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tidy(s) {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

function parseArxivAtom(xml, id) {
  if (!xml) return null;
  const entry = (xml.match(/<entry\b[\s\S]*?<\/entry>/) || [])[0];
  if (!entry) return null;
  const pick = (re) => {
    const m = entry.match(re);
    return m ? m[1] : "";
  };
  const title = tidy(pick(/<title\b[^>]*>([\s\S]*?)<\/title>/));
  if (!title || title.toLowerCase() === "error") return null;
  const summary = tidy(pick(/<summary\b[^>]*>([\s\S]*?)<\/summary>/));
  const published = pick(/<published\b[^>]*>([\s\S]*?)<\/published>/).trim().slice(0, 10);
  const authors = [...entry.matchAll(/<author\b[^>]*>\s*<name\b[^>]*>([\s\S]*?)<\/name>/g)].map((m) =>
    tidy(m[1])
  );
  const categories = [...entry.matchAll(/<category\b[^>]*term="([^"]+)"/g)].map((m) => m[1]);
  let url = pick(/<id\b[^>]*>([\s\S]*?)<\/id>/).trim();
  if (!url || !/arxiv\.org\/abs\//i.test(url)) url = `https://arxiv.org/abs/${id}`;
  url = url.replace(/^http:/i, "https:");
  return { title, summary, published, authors, categories, url };
}

module.exports = { arxivIdFromInput, parseArxivAtom };
