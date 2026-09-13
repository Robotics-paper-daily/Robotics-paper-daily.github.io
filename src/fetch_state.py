"""Durable raw-category snapshots and endpoint cooldowns for scheduled recovery."""

import hashlib
import json
import logging
import os
import re
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


class FetchStateError(RuntimeError):
    """Recovery metadata cannot safely be read or written."""


def _utc(value):
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise ValueError("expected a timezone-aware datetime")
    return value.astimezone(timezone.utc)


def _timestamp(value):
    return _utc(datetime.fromisoformat(value))


def _day(value):
    if not isinstance(value, date) or isinstance(value, datetime):
        raise ValueError("expected a date")
    return value.isoformat()


class FetchState:
    SCHEMA = 1

    def __init__(self, root, now=None):
        self.root = Path(root)
        self.now = now or (lambda: datetime.now(timezone.utc))
        state = self._read_state()
        if not (self.root / "state.json").exists():
            self._atomic_write(self.root / "state.json", state)
        self._prune_snapshots(state)

    def _read_state(self):
        path = self.root / "state.json"
        try:
            if not path.exists():
                return {"schema": self.SCHEMA, "cooldown": None, "pending": {}}
            state = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(state, dict) or state.get("schema") != self.SCHEMA:
                raise ValueError("unsupported state schema")
            if not isinstance(state.get("pending"), dict) or "cooldown" not in state:
                raise ValueError("missing recovery metadata")
            for key, task in state["pending"].items():
                if date.fromisoformat(key).isoformat() != key:
                    raise ValueError("invalid pending date")
                self._validate_cooldown(task)
                if not isinstance(task.get("category"), str) or not task["category"]:
                    raise ValueError("invalid pending category")
            if state["cooldown"] is not None:
                self._validate_cooldown(state["cooldown"])
            return state
        except (OSError, ValueError, TypeError, AttributeError) as error:
            raise FetchStateError(f"Cannot safely read recovery state {path}: {error}") from error

    @staticmethod
    def _validate_cooldown(value):
        if not isinstance(value, dict) or not isinstance(value.get("reason"), str):
            raise ValueError("invalid cooldown metadata")
        _timestamp(value.get("next_retry_at"))

    def _atomic_write(self, path, payload):
        temp_path = None
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=path.parent, prefix=".pending-", delete=False,
            ) as stream:
                temp_path = Path(stream.name)
                json.dump(payload, stream, ensure_ascii=False, allow_nan=False)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_path, path)
        except (OSError, TypeError, ValueError) as error:
            raise FetchStateError(f"Cannot persist recovery state {path}: {error}") from error
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink()

    def _snapshot_path(self, day, category):
        key = hashlib.sha256(category.encode("utf-8")).hexdigest()
        return self.root / "snapshots" / _day(day) / f"{key}.json"

    @staticmethod
    def _papers(papers, encode):
        if not isinstance(papers, list):
            raise ValueError("papers must be a list")
        result = []
        for paper in papers:
            if not isinstance(paper, dict):
                raise ValueError("paper must be an object")
            item = dict(paper)
            for field in ("title", "summary", "url"):
                if not isinstance(item.get(field), str):
                    raise ValueError(f"invalid paper {field}")
            for field in ("authors", "categories"):
                if not isinstance(item.get(field), list) or not all(
                    isinstance(value, str) for value in item[field]
                ):
                    raise ValueError(f"invalid paper {field}")
            for field in ("published_date", "updated_date"):
                value = item.get(field)
                if encode:
                    if not isinstance(value, datetime):
                        raise ValueError(f"invalid paper {field}")
                    item[field] = value.isoformat()
                else:
                    item[field] = datetime.fromisoformat(value)
            result.append(item)
        return result

    def load_snapshot(self, day, category, query, max_results=2000):
        path = self._snapshot_path(day, category)
        try:
            if not path.exists():
                return None
            data = json.loads(path.read_text(encoding="utf-8"))
            expected = {
                "schema": self.SCHEMA, "day": _day(day), "category": category,
                "query": query, "max_results": max_results, "complete": True,
            }
            if not isinstance(data, dict) or any(data.get(k) != v for k, v in expected.items()):
                raise ValueError("snapshot metadata does not match this request")
            if data.get("complete") is not True:
                raise ValueError("snapshot is incomplete")
            _timestamp(data.get("fetched_at"))
            papers = self._papers(data.get("papers"), encode=False)
            if len(papers) > max_results:
                raise ValueError("snapshot exceeds requested result limit")
            return papers
        except (OSError, ValueError, TypeError, AttributeError) as error:
            logging.warning("Ignoring invalid arXiv snapshot %s: %s", path, error)
            return None

    def save_snapshot(self, day, category, query, papers, max_results=2000):
        serialized = self._papers(papers, encode=True)
        if len(serialized) > max_results:
            raise ValueError("snapshot exceeds requested result limit")
        self._atomic_write(self._snapshot_path(day, category), {
            "schema": self.SCHEMA, "day": _day(day), "category": category,
            "query": query, "max_results": max_results, "complete": True,
            "fetched_at": _utc(self.now()).isoformat(),
            "papers": serialized,
        })

    def defer(self, day, category, retry_at, reason):
        retry_at = _utc(retry_at)
        if not isinstance(category, str) or not category or not isinstance(reason, str):
            raise ValueError("category and reason must be strings")
        state = self._read_state()
        cooldown = state["cooldown"]
        if cooldown is not None and _timestamp(cooldown["next_retry_at"]) > retry_at:
            retry_at = _timestamp(cooldown["next_retry_at"])
        next_retry = retry_at.isoformat()
        state["cooldown"] = {"next_retry_at": next_retry, "reason": reason}
        state["pending"][_day(day)] = {
            "category": category, "reason": reason, "next_retry_at": next_retry,
        }
        self._atomic_write(self.root / "state.json", state)

    def cooldown(self):
        cooldown = self._read_state()["cooldown"]
        if cooldown is not None and _timestamp(cooldown["next_retry_at"]) > _utc(self.now()):
            return dict(cooldown)
        return None

    def pending_dates(self):
        return sorted(date.fromisoformat(day) for day in self._read_state()["pending"])

    def complete_date(self, day):
        state = self._read_state()
        if state["pending"].pop(_day(day), None) is not None:
            self._atomic_write(self.root / "state.json", state)

    def _prune_snapshots(self, state):
        """Keep recent raw data even after generation, since publication may fail."""
        snapshots = self.root / "snapshots"
        if not snapshots.is_dir() or snapshots.is_symlink():
            return
        cutoff = _utc(self.now()) - timedelta(days=30)
        try:
            for directory in snapshots.iterdir():
                if not directory.is_dir() or directory.is_symlink():
                    continue
                try:
                    day = date.fromisoformat(directory.name)
                except ValueError:
                    continue
                if day.isoformat() != directory.name or directory.name in state["pending"]:
                    continue
                for path in directory.iterdir():
                    if not re.fullmatch(r"[a-f0-9]{64}\.json", path.name) or path.is_symlink():
                        continue
                    try:
                        data = json.loads(path.read_text(encoding="utf-8"))
                        if not isinstance(data, dict):
                            continue
                        category, query, limit = (data.get(key) for key in ("category", "query", "max_results"))
                        if not isinstance(category, str) or not category or not isinstance(query, str) or not query:
                            continue
                        if type(limit) is not int or limit <= 0 or self._snapshot_path(day, category) != path:
                            continue
                        if _timestamp(data.get("fetched_at")) >= cutoff:
                            continue
                        if self.load_snapshot(day, category, query, max_results=limit) is not None:
                            path.unlink()
                    except (OSError, ValueError, TypeError, AttributeError) as error:
                        logging.warning("Skipping snapshot cleanup for %s: %s", path, error)
                if not any(directory.iterdir()):
                    directory.rmdir()
        except OSError as error:
            logging.warning("Could not finish arXiv snapshot cleanup: %s", error)
