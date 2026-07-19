"""Build deterministic, size-bounded search data for the static site.

The complete index is emitted as manifest-driven monthly shards.  A bounded
selected-paper index is also written to the historical ``search_index.json``
path so already-installed desktop clients keep working during the migration.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
from collections import defaultdict
from pathlib import Path


MANIFEST_VERSION = 1
MAX_SHARD_BYTES = 50 * 1024 * 1024
LEGACY_INDEX_MAX_BYTES = 50 * 1024 * 1024
DATE_FILE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})\.json$")
SHARD_FILE_RE = re.compile(r"^\d{4}-\d{2}(?:-\d{3})?\.json$")


class SearchIndexError(RuntimeError):
    """Raised when source data cannot produce a complete, safe index."""


def is_selected(paper: dict) -> bool:
    """Match the historical-field precedence used by the HTML renderer."""
    if "stage1_selected" in paper:
        return bool(paper.get("stage1_selected"))
    if "selected" in paper:
        return bool(paper.get("selected"))
    return True


def build_search_record(paper: dict, date_str: str) -> dict:
    """Keep only fields consumed by the web and desktop search clients."""
    record = {
        "title": paper.get("title", ""),
        "summary": paper.get("summary", ""),
        "url": paper.get("url", ""),
        "date": date_str,
        "authors": paper.get("authors") or [],
        "categories": paper.get("categories") or [],
    }

    optional_fields = {
        "summary_zh": paper.get("summary_zh"),
        "tldr": paper.get("tldr"),
        "tldr_zh": paper.get("tldr_zh"),
        "score": paper.get("overall_priority_score"),
        "topic": paper.get("topic"),
    }
    for key, value in optional_fields.items():
        if value not in (None, "", 0, 0.0, [], {}):
            record[key] = value
    return record


def _json_record_size(record: dict) -> int:
    return len(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )


def _split_records(records: list[dict], max_bytes: int) -> list[list[dict]]:
    if max_bytes < 3:
        raise ValueError("max_bytes must be at least 3")

    chunks: list[list[dict]] = []
    current: list[dict] = []
    current_size = 2  # []
    for record in records:
        record_size = _json_record_size(record)
        if record_size + 2 > max_bytes:
            raise SearchIndexError(
                f"A single search record needs {record_size + 2} bytes, "
                f"above the configured shard limit of {max_bytes} bytes."
            )
        added_size = record_size + (1 if current else 0)
        if current and current_size + added_size > max_bytes:
            chunks.append(current)
            current = []
            current_size = 2
            added_size = record_size
        current.append(record)
        current_size += added_size

    if current:
        chunks.append(current)
    return chunks


def _write_json_atomic(path: Path, value, *, indent: int | None = None) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(path.name + ".tmp")
    try:
        with open(temp_path, "w", encoding="utf-8", newline="") as handle:
            json.dump(
                value,
                handle,
                ensure_ascii=False,
                indent=indent,
                separators=None if indent is not None else (",", ":"),
            )
            if indent is not None:
                handle.write("\n")
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    return path.stat().st_size


def _load_records(json_dir: Path) -> tuple[dict[str, list[dict]], list[dict]]:
    if not json_dir.is_dir():
        raise SearchIndexError(f"JSON directory does not exist: {json_dir}")

    records_by_month: dict[str, list[dict]] = defaultdict(list)
    selected_records: list[dict] = []
    for source_path in sorted(json_dir.glob("*.json")):
        match = DATE_FILE_RE.fullmatch(source_path.name)
        if not match:
            logging.warning("Skipping search source with invalid date filename: %s", source_path)
            continue
        date_str = source_path.stem
        month = f"{match.group(1)}-{match.group(2)}"
        try:
            with open(source_path, "r", encoding="utf-8") as handle:
                papers = json.load(handle)
        except (OSError, json.JSONDecodeError) as exc:
            raise SearchIndexError(f"Cannot read search source {source_path}: {exc}") from exc
        if not isinstance(papers, list):
            raise SearchIndexError(f"Search source must contain a JSON array: {source_path}")

        for position, paper in enumerate(papers):
            if not isinstance(paper, dict):
                raise SearchIndexError(
                    f"Search source item {position} is not an object: {source_path}"
                )
            record = build_search_record(paper, date_str)
            records_by_month[month].append(record)
            if is_selected(paper):
                selected_records.append(record)
    return dict(records_by_month), selected_records


def _bounded_recent_records(records: list[dict], max_bytes: int) -> list[dict]:
    """Return the newest suffix that fits, preserving chronological order."""
    kept_reversed: list[dict] = []
    current_size = 2
    for record in reversed(records):
        record_size = _json_record_size(record)
        if record_size + 2 > max_bytes:
            raise SearchIndexError(
                f"A single legacy search record exceeds its {max_bytes}-byte limit."
            )
        added_size = record_size + (1 if kept_reversed else 0)
        if kept_reversed and current_size + added_size > max_bytes:
            break
        kept_reversed.append(record)
        current_size += added_size
    return list(reversed(kept_reversed))


def generate_search_index(
    json_dir: str | Path,
    output_dir: str | Path,
    legacy_output_path: str | Path,
    *,
    max_shard_bytes: int = MAX_SHARD_BYTES,
    legacy_max_bytes: int = LEGACY_INDEX_MAX_BYTES,
) -> dict:
    """Generate full monthly shards, a manifest, and a bounded legacy index."""
    json_dir = Path(json_dir)
    output_dir = Path(output_dir)
    legacy_output_path = Path(legacy_output_path)
    if json_dir.resolve() == output_dir.resolve():
        raise SearchIndexError("Search output directory must differ from the daily JSON source directory.")
    try:
        legacy_output_path.resolve().relative_to(json_dir.resolve())
    except ValueError:
        pass
    else:
        raise SearchIndexError("Legacy search index must not overwrite a daily JSON source file.")
    try:
        legacy_output_path.resolve().relative_to(output_dir.resolve())
    except ValueError:
        pass
    else:
        raise SearchIndexError("Legacy search index must be outside the shard output directory.")
    records_by_month, selected_records = _load_records(json_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    shard_entries = []
    expected_names = {"manifest.json"}
    total_records = 0
    for month in sorted(records_by_month):
        month_records = records_by_month[month]
        chunks = _split_records(month_records, max_shard_bytes)
        total_records += len(month_records)
        for index, chunk in enumerate(chunks, start=1):
            filename = (
                f"{month}.json" if len(chunks) == 1 else f"{month}-{index:03d}.json"
            )
            shard_path = output_dir / filename
            byte_count = _write_json_atomic(shard_path, chunk)
            if byte_count > max_shard_bytes:
                raise SearchIndexError(
                    f"Generated shard {shard_path} is {byte_count} bytes, "
                    f"above its {max_shard_bytes}-byte limit."
                )
            expected_names.add(filename)
            shard_entries.append(
                {
                    "file": filename,
                    "month": month,
                    "count": len(chunk),
                    "bytes": byte_count,
                }
            )

    legacy_records = _bounded_recent_records(selected_records, legacy_max_bytes)
    legacy_bytes = _write_json_atomic(legacy_output_path, legacy_records)
    if legacy_bytes > legacy_max_bytes:
        raise SearchIndexError(
            f"Legacy index is {legacy_bytes} bytes, above its {legacy_max_bytes}-byte limit."
        )

    manifest = {
        "version": MANIFEST_VERSION,
        "total": total_records,
        "shards": shard_entries,
        "legacy": {
            "count": len(legacy_records),
            "selectedTotal": len(selected_records),
            "bytes": legacy_bytes,
            "maxBytes": legacy_max_bytes,
        },
    }
    _write_json_atomic(output_dir / "manifest.json", manifest, indent=2)

    for stale_path in output_dir.glob("*.json"):
        if SHARD_FILE_RE.fullmatch(stale_path.name) and stale_path.name not in expected_names:
            stale_path.unlink()
            logging.info("Removed stale search shard: %s", stale_path)
    for temp_path in output_dir.glob("*.json.tmp"):
        target_name = temp_path.name.removesuffix(".tmp")
        if target_name == "manifest.json" or SHARD_FILE_RE.fullmatch(target_name):
            temp_path.unlink()

    logging.info(
        "Search index generated: %s papers in %s shards; legacy index %s/%s papers (%s bytes).",
        total_records,
        len(shard_entries),
        len(legacy_records),
        len(selected_records),
        legacy_bytes,
    )
    return manifest


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Generate bounded search-index shards.")
    parser.add_argument("--json-dir", type=Path, default=project_root / "daily_json")
    parser.add_argument("--output-dir", type=Path, default=project_root / "search_index")
    parser.add_argument(
        "--legacy-output",
        type=Path,
        default=project_root / "search_index.json",
    )
    return parser.parse_args()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    args = parse_args()
    generate_search_index(args.json_dir, args.output_dir, args.legacy_output)
