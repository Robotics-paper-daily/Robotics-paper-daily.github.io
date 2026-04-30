"""Rescore Stage-1 fields on existing daily_json/*.json files.

Use this after changing the keyword tiers, weights, or threshold in
``config.py`` to retroactively apply the new rules to historical data
**without** re-running the LLM. Existing LLM scores (tldr / topic / scores
/ summary_zh) are preserved on every paper, only the ``stage1_*`` fields
get rewritten.

Usage:
    python src/rescore_stage1.py              # rescore everything in-place
    python src/rescore_stage1.py --dry-run    # show stats without writing
    python src/rescore_stage1.py --json-dir other_dir
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from filter import prefilter_papers_by_keywords

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JSON_DIR = PROJECT_ROOT / "daily_json"

# Stage-1 fields that get rebuilt every run.
_STAGE1_FIELDS = (
    "stage1_score",
    "stage1_breakdown",
    "stage1_match_terms",
    "stage1_selected",
    "selected",
    "stage1_reason",
)

# LLM-produced fields we must preserve across rescoring.
_LLM_FIELDS = (
    "tldr",
    "tldr_zh",
    "topic",
    "keywords",
    "relevance_score",
    "novelty_claim_score",
    "clarity_score",
    "potential_impact_score",
    "overall_priority_score",
    "summary_zh",
)


def rescore_file(path: Path, dry_run: bool = False) -> tuple[int, int, int]:
    """Rescore one JSON file. Returns (selected_now, rejected_now, total)."""
    try:
        papers = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logging.error("无法读取 %s: %s", path.name, e)
        return 0, 0, 0

    if not isinstance(papers, list):
        logging.warning("%s 不是 JSON 数组，跳过。", path.name)
        return 0, 0, 0

    # Strip stage-1 fields so prefilter recomputes them from scratch.
    # ai_processed must be remembered separately so we can restore it on
    # papers that previously had LLM scores but now fall below threshold.
    had_llm = []
    for paper in papers:
        had_llm.append(any(k in paper for k in _LLM_FIELDS))
        for key in _STAGE1_FIELDS:
            paper.pop(key, None)

    selected, rejected = prefilter_papers_by_keywords(papers)

    # prefilter sets ai_processed=False on everything it rejects, but if a
    # paper kept its LLM data from before, mark ai_processed=True so the
    # downstream renderer still trusts those scores.
    for paper, was_llm in zip(papers, had_llm):
        if was_llm and any(k in paper for k in _LLM_FIELDS):
            paper["ai_processed"] = True

    if not dry_run:
        path.write_text(
            json.dumps(papers, ensure_ascii=False, indent=4),
            encoding="utf-8",
        )

    return len(selected), len(rejected), len(papers)


def rescore_all(json_dir: Path, dry_run: bool) -> None:
    if not json_dir.exists():
        raise FileNotFoundError(f"JSON 目录不存在: {json_dir}")

    json_files = sorted(json_dir.glob("*.json"))
    if not json_files:
        logging.warning("未找到任何 JSON 文件，跳过。")
        return

    total_selected = 0
    total_rejected = 0
    total_papers = 0

    for i, path in enumerate(json_files, start=1):
        sel, rej, tot = rescore_file(path, dry_run=dry_run)
        total_selected += sel
        total_rejected += rej
        total_papers += tot
        logging.info(
            "[%s/%s] %s -> selected=%s, rejected=%s, total=%s%s",
            i,
            len(json_files),
            path.name,
            sel,
            rej,
            tot,
            " (dry-run)" if dry_run else "",
        )

    logging.info(
        "汇总：selected=%s, rejected=%s, total=%s, pass_rate=%.1f%%%s",
        total_selected,
        total_rejected,
        total_papers,
        100 * total_selected / total_papers if total_papers else 0,
        " (dry-run)" if dry_run else "",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="基于新关键词规则回填历史 JSON 的 stage1 字段。")
    parser.add_argument("--json-dir", type=Path, default=DEFAULT_JSON_DIR, help="JSON 目录")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印统计，不写文件",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    rescore_all(args.json_dir, args.dry_run)
