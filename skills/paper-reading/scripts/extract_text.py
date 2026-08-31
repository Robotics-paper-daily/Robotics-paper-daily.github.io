#!/usr/bin/env python3
"""Dump a PDF's text to a UTF-8 file, page by page, for reading.

Why this exists: in some environments the Read tool cannot open
image-containing PDFs (it mislabels them "password-protected"). Almost every
arxiv paper has figures, so reading the PDF directly is unreliable. Extracting
the text with PyMuPDF and reading that .txt is reliable, cheap, and faithful —
it preserves the method, experiments, ablations, and appendix as text. For
figures (and for any page where equations or tables come out garbled), render
that page to an image with extract_figures.py and view the image instead.

Writes UTF-8 to a file (NOT stdout) so Windows console encoding never mangles
smart quotes or math symbols.

Usage:
  python3 extract_text.py <pdf> [--out PATH] [--pages 1-13]

Prints JSON: {out, page_count, pages_extracted, chars}.
"""
import argparse
import json
import os
import re
import sys

import fitz  # PyMuPDF

# Some PDFs emit NUL / control bytes (e.g. from figure glyphs) that make the
# output look "binary" to grep and other tools. Strip C0 controls except \t\n\r.
CTRL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')

try:  # Windows console is GBK; keep stdout JSON safe for non-ASCII paths
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def parse_pages(spec, n):
    if not spec:
        return list(range(n))
    out = []
    for part in spec.split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-')
            out += list(range(int(a) - 1, int(b)))
        else:
            out.append(int(part) - 1)
    return [p for p in out if 0 <= p < n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--out", default=None)
    ap.add_argument("--pages", default=None, help="e.g. 1-13 or 1,2,5")
    args = ap.parse_args()

    doc = fitz.open(args.pdf)
    n = doc.page_count
    out = args.out or (os.path.splitext(args.pdf)[0] + ".txt")
    pages = parse_pages(args.pages, n)

    chars = 0
    with open(out, "w", encoding="utf-8") as f:
        for i in pages:
            t = CTRL.sub("", doc[i].get_text("text"))
            chars += len(t)
            f.write("\n===== PAGE %d/%d =====\n" % (i + 1, n))
            f.write(t)

    print(json.dumps({"out": os.path.abspath(out), "page_count": n,
                      "pages_extracted": len(pages), "chars": chars},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
