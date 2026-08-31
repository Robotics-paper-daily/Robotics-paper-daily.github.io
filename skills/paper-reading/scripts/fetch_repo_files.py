#!/usr/bin/env python3
"""List or download source files from a GitHub repo — used to record a paper's
framework implementation alongside its note.

Usage:
  python3 fetch_repo_files.py "<github url | owner/repo>" --list
  python3 fetch_repo_files.py "<repo>" <out_dir> --paths weaver/wm/model.py,weaver/config.yaml
  python3 fetch_repo_files.py "<repo>" <out_dir> --like model,net,flow,reward,dynamics,config

`--list` prints repo metadata + the source-file tree (.py/.yaml/.yml/.md/.json/
.cfg/.toml/.txt) so you can pick the files that implement the framework. Then
download by exact `--paths` or by `--like` (substring match on the path). With
neither, all source files are downloaded. Saved names flatten the directory with
'__' so they stay unique and readable (weaver/wm/model.py -> weaver__wm__model.py).

No clone — uses the GitHub API (tree) + raw.githubusercontent.com, so large
asset/checkpoint repos cost nothing. Prints JSON.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

UA = "paper-reading-skill"
SRC_EXT = ('.py', '.yaml', '.yml', '.md', '.json', '.cfg', '.toml', '.txt', '.sh')


def parse_repo(s):
    s = s.strip().rstrip('/')
    m = re.search(r'github\.com[/:]([^/]+)/([^/]+?)(?:\.git)?$', s)
    if m:
        return m.group(1), m.group(2)
    if '/' in s and ' ' not in s:
        a, b = s.split('/', 1)
        return a, b.split('/')[0]
    return None, None


def gj(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return json.load(urllib.request.urlopen(req, timeout=30))


def fetch_bytes(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return urllib.request.urlopen(req, timeout=60).read()
        except Exception as e:  # transient SSL/EOF happens; retry
            last = e
            time.sleep(1.0 + i)
    raise last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("out_dir", nargs="?", default=None)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--paths", default=None)
    ap.add_argument("--like", default=None)
    args = ap.parse_args()

    owner, repo = parse_repo(args.repo)
    if not owner:
        print(json.dumps({"error": "could not parse owner/repo from %r" % args.repo}))
        sys.exit(2)
    try:
        meta = gj("https://api.github.com/repos/%s/%s" % (owner, repo))
        branch = meta.get("default_branch", "main")
        tree = gj("https://api.github.com/repos/%s/%s/git/trees/%s?recursive=1"
                  % (owner, repo, branch))
    except Exception as e:
        print(json.dumps({"error": "GitHub API failed (%s) — repo private/renamed?"
                          % e}))
        sys.exit(2)

    blobs = [(t["path"], t.get("size", 0)) for t in tree.get("tree", [])
             if t.get("type") == "blob"]
    src = sorted((p, s) for p, s in blobs if p.endswith(SRC_EXT))

    if args.list or not args.out_dir:
        print(json.dumps({"repo": "%s/%s" % (owner, repo), "branch": branch,
                          "size_kb": meta.get("size"),
                          "pushed_at": meta.get("pushed_at"),
                          "homepage": meta.get("homepage"),
                          "source_files": [{"path": p, "size": s} for p, s in src]},
                         ensure_ascii=False, indent=2))
        return

    want = {p.strip() for p in args.paths.split(',')} if args.paths else set()
    likes = [w.strip().lower() for w in args.like.split(',')] if args.like else None
    sel = [p for p, _ in src
           if (p in want) or (likes and any(k in p.lower() for k in likes))]
    if not want and not likes:
        sel = [p for p, _ in src]

    os.makedirs(args.out_dir, exist_ok=True)
    raw = "https://raw.githubusercontent.com/%s/%s/%s/" % (owner, repo, branch)
    saved = []
    for p in sel:
        out = os.path.join(args.out_dir, p.replace('/', '__'))
        try:
            data = fetch_bytes(raw + p)
            with open(out, "wb") as f:
                f.write(data)
            saved.append({"path": p, "saved": out, "bytes": len(data)})
        except Exception as e:
            saved.append({"path": p, "error": str(e)})
    print(json.dumps({"repo": "%s/%s" % (owner, repo), "branch": branch,
                      "downloaded": saved}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
