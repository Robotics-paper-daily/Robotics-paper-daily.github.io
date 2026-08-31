#!/usr/bin/env python3
"""Download original figure images from an arxiv HTML paper (arxiv.org/html/<id>).

Much cleaner than cropping figures out of the PDF: the HTML hosts each figure as
its own image asset (PNG/SVG/JPG) with its caption. Prefer this for the
architecture / key figures whenever the HTML version exists; fall back to
extract_figures.py (PDF scan + clip) only if it doesn't.

Two-step workflow:
  1) list the image-figures (no download), read the captions, pick the key ones:
       python3 fetch_html_figures.py "<arxiv url | id>" <out_dir> --list
  2) download just those (by their HTML figure number), or all:
       python3 fetch_html_figures.py "<arxiv url | id>" <out_dir> --only 1,5
       python3 fetch_html_figures.py "<arxiv url | id>" <out_dir>          # all

Notes:
- Only image-bearing <figure> elements are returned; <figure>s that wrap a table
  are skipped (use the text dump for tables).
- HTML figure numbering can differ from the PDF's (LaTeXML re-numbers, and
  teaser figures sometimes shift). The `caption` field is authoritative for what
  a figure shows — caption your embed from it, not from the number alone.
- Files are saved as fig<htmlnum><ext> (e.g. fig1.png).

Prints JSON: {html_url, count, figures:[{num,label,caption,src,url,path|error}]}.
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from urllib.parse import urljoin

try:  # Windows console/pipe is GBK; captions may hold math unicode (e.g. π0's 𝜋)
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

UA = "Mozilla/5.0 (paper-reading-skill) Python-urllib"
NEW = re.compile(r'(\d{4}\.\d{4,5})(v\d+)?')
OLD = re.compile(r'([a-z\-]+(?:\.[A-Z]{2})?/\d{7})(v\d+)?')


def arxiv_id(s):
    s = s.strip()
    for rx in (NEW, OLD):
        m = rx.search(s)
        if m:
            return m.group(1) + (m.group(2) or '')
    return None


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8', 'replace'), r.geturl()


def parse_figures(html):
    """Return list of {num, label, caption, src} for image-bearing figures."""
    figs = []
    for b in re.findall(r'<figure\b.*?</figure>', html, re.S):
        m = re.search(r'<img[^>]*?\bsrc="([^"]+)"', b)
        if not m:
            continue  # table-figure or non-image
        src = m.group(1)
        cap = re.search(r'<figcaption.*?</figcaption>', b, re.S)
        captext = re.sub(r'<[^>]+>', ' ', cap.group(0)) if cap else ''
        captext = re.sub(r'\s+', ' ', captext).strip()
        lm = re.match(r'(?:Figure|Fig\.?|Table)\s*(\d+)', captext)
        figs.append({"num": int(lm.group(1)) if lm else None,
                     "label": lm.group(0) if lm else None,
                     "caption": captext, "src": src})
    return figs


HTML_ROOT = "https://arxiv.org/html/"
# Some papers' <img src> already carries the paper's id/version dir, e.g.
# "2606.13672v1/x2.png" — that is relative to the /html/ ROOT, not to the page
# URL. Others use a bare "x1.png" or "figures/..." relative to the page dir.
ID_PREFIX = re.compile(r'^(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})/')


def resolve_url(page, src):
    if src.startswith(("http://", "https://")):
        return src
    if ID_PREFIX.match(src):
        return HTML_ROOT + src
    base = page if page.endswith("/") else page + "/"
    return urljoin(base, src)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("out_dir")
    ap.add_argument("--list", action="store_true",
                    help="list figures without downloading")
    ap.add_argument("--only", default=None,
                    help="comma figure numbers to download (default: all)")
    args = ap.parse_args()

    aid = arxiv_id(args.input) or args.input.strip()
    url = "https://arxiv.org/html/%s" % aid
    try:
        html, final = fetch(url)
    except Exception as e:
        print(json.dumps({"error": "could not fetch HTML (%s): %s — paper may "
                          "have no HTML version; fall back to PDF figures"
                          % (url, e)}))
        sys.exit(2)
    figs = parse_figures(html)

    if args.list:
        for f in figs:
            f["url"] = resolve_url(final, f["src"])
            f["caption"] = f["caption"][:300]
        print(json.dumps({"html_url": final, "count": len(figs),
                          "figures": figs}, ensure_ascii=False, indent=2))
        return

    only = None
    if args.only:
        only = set(int(x) for x in re.findall(r'\d+', args.only))

    os.makedirs(args.out_dir, exist_ok=True)
    out = []
    for idx, f in enumerate(figs, 1):
        if only is not None and f["num"] not in only:
            continue
        img_url = resolve_url(final, f["src"])
        ext = os.path.splitext(f["src"])[1] or '.png'
        name = ("fig%d" % f["num"]) if f["num"] else ("fig_%d" % idx)
        path = os.path.join(args.out_dir, name + ext)
        rec = {"num": f["num"], "label": f["label"],
               "caption": f["caption"][:300], "src": f["src"], "url": img_url}
        try:
            req = urllib.request.Request(img_url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as fh:
                fh.write(r.read())
            rec["path"] = path
        except Exception as e:
            rec["error"] = str(e)
        out.append(rec)

    print(json.dumps({"html_url": final, "count": len(out), "figures": out},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
