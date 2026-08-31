#!/usr/bin/env python3
"""Fetch an arxiv paper (metadata + PDF) or accept a local PDF.

Usage:
  python3 fetch_paper.py "<arxiv url | arxiv id | local .pdf path>" --out-dir DIR

Prints a JSON object to stdout with the paper metadata and the local PDF path
that downstream steps (Read tool, extract_figures.py) can use.

Notes:
- arxiv metadata comes from the public arxiv API (title, authors, dates,
  categories, abstract). If the API is unreachable the PDF is still downloaded
  and the note can be filled from the PDF first page.
- PDFs are cached by id under --out-dir so re-runs don't re-download.
"""
import argparse
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

try:  # Windows console/pipe is GBK; titles may hold math unicode (e.g. π0's 𝜋)
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

UA = "Mozilla/5.0 (paper-reading-skill) Python-urllib"

ARXIV_NEW = re.compile(r'(\d{4}\.\d{4,5})(v\d+)?')
ARXIV_OLD = re.compile(r'([a-z\-]+(?:\.[A-Z]{2})?/\d{7})(v\d+)?')


def extract_arxiv_id(s):
    s = s.strip()
    m = ARXIV_NEW.search(s)
    if m:
        return m.group(1) + (m.group(2) or '')
    m = ARXIV_OLD.search(s)
    if m:
        return m.group(1) + (m.group(2) or '')
    return None


def fetch_metadata(arxiv_id):
    base = re.sub(r'v\d+$', '', arxiv_id)
    url = "http://export.arxiv.org/api/query?id_list=%s" % base
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    ns = {"a": "http://www.w3.org/2005/Atom",
          "arxiv": "http://arxiv.org/schemas/atom"}
    root = ET.fromstring(data)
    entry = root.find("a:entry", ns)
    if entry is None:
        return {}

    def text(tag):
        el = entry.find(tag, ns)
        return el.text.strip() if el is not None and el.text else None

    title = text("a:title")
    if title:
        title = re.sub(r'\s+', ' ', title)
    summary = text("a:summary")
    if summary:
        summary = re.sub(r'\s+', ' ', summary).strip()
    authors = [a.find("a:name", ns).text.strip()
               for a in entry.findall("a:author", ns)
               if a.find("a:name", ns) is not None]
    published = text("a:published")
    if published:
        published = published[:10]
    updated = text("a:updated")
    if updated:
        updated = updated[:10]
    cats = [c.get("term") for c in entry.findall("a:category", ns)]
    prim = entry.find("arxiv:primary_category", ns)
    primary = prim.get("term") if prim is not None else (cats[0] if cats else None)
    return {"title": title, "authors": authors, "published": published,
            "updated": updated, "categories": cats,
            "primary_category": primary, "abstract": summary}


def download_pdf(arxiv_id, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    base = re.sub(r'v\d+$', '', arxiv_id)
    fname = base.replace('/', '_') + ".pdf"
    path = os.path.join(out_dir, fname)
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return path  # cached
    url = "https://arxiv.org/pdf/%s.pdf" % arxiv_id
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


def make_readable(path, cache_dir):
    """Return (readable_path, warning). arxiv PDFs are frequently encrypted
    with an owner password (empty user password); PyMuPDF opens them but the
    Read tool rejects "password-protected" PDFs. When that's the case, save a
    decrypted copy into cache_dir and point downstream steps at it. The user's
    original local file is never modified."""
    try:
        import fitz  # noqa: F811 (PyMuPDF, also used by extract_figures.py)
    except Exception:
        return path, "PyMuPDF unavailable; skipped encryption check"
    try:
        doc = fitz.open(path)
    except Exception as e:
        return path, "could not open pdf: %s" % e
    # NOTE: doc.is_encrypted flips to False once fitz auto-authenticates the
    # empty user password, but the *file on disk* is still encrypted — which is
    # what the Read tool chokes on. metadata["encryption"] reflects the on-disk
    # state and is the reliable signal.
    enc = (doc.metadata or {}).get("encryption")
    if not enc:
        doc.close()
        return path, None
    doc.authenticate("")  # arxiv uses an empty user password
    os.makedirs(cache_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(cache_dir, base + ".dec.pdf")
    try:
        doc.save(out, encryption=fitz.PDF_ENCRYPT_NONE)
        doc.close()
        return os.path.abspath(out), None
    except Exception as e:
        try:
            doc.close()
        except Exception:
            pass
        return path, "decrypt failed: %s" % e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    # Never guess a vault-relative cache. PaperReader supplies its dedicated
    # userData cache explicitly, and standalone callers must make the same
    # ownership decision themselves.
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()

    inp = args.input.strip().strip('"')
    result = {"input": inp}

    if os.path.exists(inp) and inp.lower().endswith(".pdf"):
        result.update({"source": "local", "arxiv_id": None})
        pdf, warn = make_readable(os.path.abspath(inp), args.out_dir)
        result["pdf_path"] = pdf
        if warn:
            result["decrypt_warning"] = warn
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    aid = extract_arxiv_id(inp)
    if not aid:
        result["error"] = ("Could not parse an arxiv id, and the input is not "
                           "an existing local .pdf path.")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(2)

    result["source"] = "arxiv"
    result["arxiv_id"] = aid
    result["url"] = "https://arxiv.org/abs/%s" % aid
    result["pdf_url"] = "https://arxiv.org/pdf/%s.pdf" % aid
    try:
        result.update(fetch_metadata(aid))
    except Exception as e:
        result["metadata_error"] = "%s: %s" % (type(e).__name__, e)
    try:
        raw = os.path.abspath(download_pdf(aid, args.out_dir))
        pdf, warn = make_readable(raw, args.out_dir)
        result["pdf_path"] = pdf
        if warn:
            result["decrypt_warning"] = warn
    except Exception as e:
        result["pdf_error"] = "%s: %s" % (type(e).__name__, e)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
