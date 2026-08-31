#!/usr/bin/env python3
"""Extract original figures from a PDF for embedding into notes (PyMuPDF).

Modes
-----
  scan    Map each page: embedded raster images (xref + pixel size) and any
          "Figure N" / "Table N" captions with their bounding boxes. Cheap —
          run this first to locate the key figures without rendering anything.
  images  Save embedded raster images larger than --min-size px. Clean crops
          when a figure is stored as a single bitmap (screenshots, photos, many
          exported architecture diagrams).
  pages   Render whole pages to PNG. Use for vector figures that `images` misses,
          or to eyeball a page before clipping.
  clip    Render a rectangular region (PDF points, from `scan` bboxes) of one
          page to PNG. Best for a clean crop of a vector figure.

Examples
--------
  python3 extract_figures.py paper.pdf out/ --mode scan
  python3 extract_figures.py paper.pdf out/ --mode images --min-size 220
  python3 extract_figures.py paper.pdf out/ --mode pages --pages 3,5 --dpi 160
  python3 extract_figures.py paper.pdf out/ --mode clip --page 4 \
         --rect 54,90,540,360 --dpi 200 --name arch-overview

Coordinates: PDF points, origin top-left, as reported by `scan` bboxes.
"""
import argparse
import json
import os
import re
import sys

import fitz  # PyMuPDF

try:  # Windows console is GBK; captions may hold math unicode
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

CAP =re.compile(r'^\s*(Figure|Fig\.?|Table)\s*\.?\s*(\d+)', re.I)


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


def save_image_xref(doc, xref, path):
    pix = fitz.Pixmap(doc, xref)
    if pix.colorspace and pix.colorspace.n >= 4:  # CMYK -> RGB
        pix = fitz.Pixmap(fitz.csRGB, pix)
    pix.save(path)
    return pix.width, pix.height


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("out_dir")
    ap.add_argument("--mode", choices=["scan", "images", "pages", "clip"],
                    default="scan")
    ap.add_argument("--pages", default=None, help="e.g. 3,5 or 2-6")
    ap.add_argument("--min-size", type=int, default=200)
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--page", type=int, default=None)
    ap.add_argument("--rect", default=None, help="x0,y0,x1,y1 in PDF points")
    ap.add_argument("--name", default=None)
    args = ap.parse_args()

    doc = fitz.open(args.pdf)
    n = doc.page_count
    os.makedirs(args.out_dir, exist_ok=True)

    if args.mode == "scan":
        pages = []
        for i in range(n):
            page = doc[i]
            imgs = []
            for img in page.get_images(full=True):
                imgs.append({"xref": img[0], "w": img[2], "h": img[3]})
            caps = []
            for b in page.get_text("blocks"):
                txt = (b[4] or "").strip()
                m = CAP.match(txt)
                if m:
                    caps.append({
                        "label": "%s %s" % (m.group(1).title().rstrip('.'),
                                            m.group(2)),
                        "bbox": [round(b[0]), round(b[1]),
                                 round(b[2]), round(b[3])],
                        "text": re.sub(r'\s+', ' ', txt)[:140],
                    })
            pages.append({
                "page": i + 1,
                "size": [round(page.rect.width), round(page.rect.height)],
                "images": imgs,
                "captions": caps,
            })
        print(json.dumps({"pdf": os.path.abspath(args.pdf),
                          "page_count": n, "pages": pages},
                         ensure_ascii=False, indent=2))
        return

    if args.mode == "images":
        manifest = []
        seen = set()
        for i in parse_pages(args.pages, n):
            page = doc[i]
            for j, img in enumerate(page.get_images(full=True)):
                xref = img[0]
                if xref in seen:
                    continue
                seen.add(xref)
                if img[2] < args.min_size or img[3] < args.min_size:
                    continue
                path = os.path.join(args.out_dir,
                                    "p%02d_img%d.png" % (i + 1, j + 1))
                try:
                    w, h = save_image_xref(doc, xref, path)
                    manifest.append({"page": i + 1, "xref": xref,
                                     "w": w, "h": h, "path": path})
                except Exception as e:
                    manifest.append({"page": i + 1, "xref": xref,
                                     "error": str(e)})
        print(json.dumps({"saved": manifest}, ensure_ascii=False, indent=2))
        return

    if args.mode == "pages":
        manifest = []
        for i in parse_pages(args.pages, n):
            pix = doc[i].get_pixmap(dpi=args.dpi)
            path = os.path.join(args.out_dir, "page%02d.png" % (i + 1))
            pix.save(path)
            manifest.append({"page": i + 1, "w": pix.width,
                             "h": pix.height, "path": path})
        print(json.dumps({"saved": manifest}, ensure_ascii=False, indent=2))
        return

    if args.mode == "clip":
        if args.page is None or not args.rect:
            print(json.dumps({"error": "clip needs --page and --rect "
                                       "x0,y0,x1,y1"}))
            sys.exit(2)
        x0, y0, x1, y1 = [float(v) for v in args.rect.split(',')]
        pix = doc[args.page - 1].get_pixmap(
            dpi=args.dpi, clip=fitz.Rect(x0, y0, x1, y1))
        name = args.name or ("p%02d_clip" % args.page)
        path = os.path.join(args.out_dir, "%s.png" % name)
        pix.save(path)
        print(json.dumps({"saved": [{"page": args.page,
                                     "rect": [x0, y0, x1, y1],
                                     "w": pix.width, "h": pix.height,
                                     "path": path}]},
                         ensure_ascii=False, indent=2))
        return


if __name__ == "__main__":
    main()
