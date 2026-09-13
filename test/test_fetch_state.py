"""Recovery metadata survives new processes without weakening cooldowns."""

import importlib.util
import json
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "fetch_state_under_test", Path(__file__).resolve().parents[1] / "src" / "fetch_state.py",
)
state_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(state_module)
FetchState = state_module.FetchState


class FetchStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = self.enterContext(tempfile.TemporaryDirectory())
        self.root = Path(self.temp)
        self.now = datetime(2026, 9, 12, tzinfo=timezone.utc)
        self.day = date(2026, 9, 11)
        self.state = FetchState(self.root, now=lambda: self.now)
        self.paper = {
            "title": "Paper", "summary": "Abstract", "url": "https://arxiv.org/abs/2609.00001",
            "published_date": self.now, "updated_date": self.now,
            "authors": ["Author"], "categories": ["cs.RO"],
        }

    def test_snapshot_restores_raw_fields_and_datetimes_across_instances(self):
        self.state.save_snapshot(self.day, "cs.RO", "query", [self.paper])
        restored = FetchState(self.root).load_snapshot(self.day, "cs.RO", "query")
        self.assertEqual(restored, [self.paper])

    def test_new_state_initializes_manifest_and_fetch_timestamp(self):
        self.assertEqual(json.loads((self.root / "state.json").read_text()), {
            "schema": 1, "pending": {}, "cooldown": None,
        })
        self.state.save_snapshot(self.day, "cs.RO", "query", [])
        data = json.loads(self.state._snapshot_path(self.day, "cs.RO").read_text())
        self.assertEqual(data["fetched_at"], self.now.isoformat())

    def test_valid_empty_snapshot_is_distinct_from_cache_miss(self):
        self.assertIsNone(self.state.load_snapshot(self.day, "cs.RO", "query"))
        self.state.save_snapshot(self.day, "cs.RO", "query", [])
        self.assertEqual(self.state.load_snapshot(self.day, "cs.RO", "query"), [])

    def test_mismatched_or_incomplete_snapshots_are_cache_misses(self):
        self.state.save_snapshot(self.day, "cs.RO", "query", [self.paper])
        self.assertIsNone(self.state.load_snapshot(self.day, "cs.RO", "new query"))
        self.assertIsNone(self.state.load_snapshot(self.day, "cs.RO", "query", max_results=100))
        self.assertIsNone(self.state.load_snapshot(self.day, "cs.AI", "query"))
        path = self.state._snapshot_path(self.day, "cs.RO")
        baseline = json.loads(path.read_text())
        for field, value in (
            ("schema", 0), ("complete", False), ("complete", 1),
            ("day", "2026-09-10"), ("papers", [{"title": "partial"}]),
            ("fetched_at", None), ("fetched_at", "2026-09-12"),
        ):
            with self.subTest(field=field, value=value):
                data = dict(baseline, **{field: value})
                self.state._atomic_write(path, data)
                self.assertIsNone(self.state.load_snapshot(self.day, "cs.RO", "query"))

    def test_corrupt_snapshot_is_a_cache_miss(self):
        path = self.state._snapshot_path(self.day, "cs.RO")
        with mock.patch.object(Path, "exists", return_value=True), mock.patch.object(
            Path, "read_text", return_value="<html>Rate exceeded</html>",
        ):
            self.assertIsNone(self.state.load_snapshot(self.day, "cs.RO", "query"))

    def test_cooldown_and_pending_survive_new_instance_and_cache_hits(self):
        retry_at = self.now + timedelta(hours=2)
        self.state.defer(self.day, "cs.AI", retry_at, "HTTP 429")
        self.state.save_snapshot(self.day, "cs.RO", "query", [self.paper])
        restored = FetchState(self.root, now=lambda: self.now)
        self.assertEqual(restored.pending_dates(), [self.day])
        self.assertEqual(restored.load_snapshot(self.day, "cs.RO", "query"), [self.paper])
        self.assertEqual(restored.cooldown(), {
            "next_retry_at": retry_at.isoformat(), "reason": "HTTP 429",
        })
        self.now += timedelta(hours=2)
        self.assertIsNone(restored.cooldown())
        self.assertEqual(restored.pending_dates(), [self.day])

    def test_new_shorter_deferral_cannot_shorten_global_cooldown(self):
        self.state.defer(self.day, "cs.AI", self.now + timedelta(hours=4), "server cooldown")
        earlier = self.day - timedelta(days=1)
        self.state.defer(earlier, "cs.CV", self.now + timedelta(hours=2), "HTTP 429")
        self.assertEqual(self.state.pending_dates(), [earlier, self.day])
        self.assertEqual(self.state.cooldown()["next_retry_at"], (self.now + timedelta(hours=4)).isoformat())

    def test_complete_date_clears_only_its_pending_entry(self):
        other = self.day - timedelta(days=1)
        self.state.defer(self.day, "cs.AI", self.now + timedelta(hours=2), "HTTP 429")
        self.state.defer(other, "cs.RO", self.now + timedelta(hours=2), "HTTP 429")
        self.state.save_snapshot(self.day, "cs.RO", "query", [])
        self.state.save_snapshot(other, "cs.RO", "query", [])
        self.state.complete_date(self.day)
        self.assertEqual(self.state.pending_dates(), [other])
        self.assertIsNotNone(self.state.cooldown())
        self.assertEqual(self.state.load_snapshot(self.day, "cs.RO", "query"), [])
        self.assertEqual(self.state.load_snapshot(other, "cs.RO", "query"), [])

    def test_prune_keeps_pending_recent_and_unrecognized_snapshots(self):
        pending = self.day - timedelta(days=1)
        self.state.save_snapshot(self.day, "cs.RO", "query", [])
        self.state.save_snapshot(pending, "cs.RO", "query", [])
        self.state.defer(pending, "cs.AI", self.now + timedelta(hours=2), "429")
        # A mismatched path must not be deleted even if its JSON resembles a snapshot.
        source = self.state._snapshot_path(self.day, "cs.RO")
        unknown = source.parent / ("a" * 64 + ".json")
        self.state._atomic_write(unknown, json.loads(source.read_text()))
        self.now += timedelta(days=29)
        recent = FetchState(self.root, now=lambda: self.now)
        self.assertEqual(recent.load_snapshot(self.day, "cs.RO", "query"), [])
        self.now += timedelta(days=2)
        restored = FetchState(self.root, now=lambda: self.now)
        self.assertIsNone(restored.load_snapshot(self.day, "cs.RO", "query"))
        self.assertEqual(restored.load_snapshot(pending, "cs.RO", "query"), [])
        self.assertTrue(unknown.exists())
        self.assertEqual(restored.pending_dates(), [pending])

    def test_corrupt_global_state_fails_closed_for_every_operation(self):
        for payload in ("invalid JSON", {}, {"schema": 1, "pending": {}, "cooldown": {"reason": "429"}}):
            with self.subTest(payload=payload):
                self.state._atomic_write(self.root / "state.json", payload)
                for operation in (
                    self.state.cooldown, self.state.pending_dates,
                    lambda: self.state.complete_date(self.day),
                    lambda: self.state.defer(self.day, "cs.RO", self.now, "429"),
                ):
                    with self.assertRaises(state_module.FetchStateError):
                        operation()

    def test_failed_atomic_replace_preserves_previous_state(self):
        self.state.defer(self.day, "cs.AI", self.now + timedelta(hours=2), "original")
        with mock.patch.object(state_module.os, "replace", side_effect=OSError("disk failure")):
            with self.assertRaises(state_module.FetchStateError):
                self.state.defer(self.day, "cs.RO", self.now + timedelta(hours=4), "new")
        self.assertEqual(self.state.cooldown()["reason"], "original")
        self.assertEqual(list(self.root.glob(".pending-*")), [])


if __name__ == "__main__":
    unittest.main()
