"""Offline recovery runs with durable snapshots and real search-index files."""

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from test.test_scraper import load_scraper_module


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
CATEGORIES = ["cs.RO", "cs.AI", "cs.CV", "cs.LG"]


def load_source(name, filename):
    spec = importlib.util.spec_from_file_location(name, SRC_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_pipeline():
    scraper, _ = load_scraper_module()
    fetch_state = load_source("recovery_state_under_test", "fetch_state.py")
    search_index = load_source("recovery_index_under_test", "search_index.py")
    filter_module = types.ModuleType("filter")
    filter_module.prefilter_papers_by_keywords = mock.Mock()
    filter_module.filter_and_rate_papers = mock.Mock()
    filter_module.translate_summaries = mock.Mock()
    html_generator = types.ModuleType("html_generator")
    html_generator.generate_html_from_json = mock.Mock()
    config = types.ModuleType("config")
    config.TRANSLATION_MIN_SCORE = 7
    with mock.patch.dict(sys.modules, {
        "scraper": scraper,
        "fetch_state": fetch_state,
        "search_index": search_index,
        "filter": filter_module,
        "html_generator": html_generator,
        "config": config,
    }):
        main = load_source("pipeline_recovery_under_test", "main.py")
    return main, scraper, fetch_state.FetchState


class PipelineRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.main, self.scraper, self.FetchState = load_pipeline()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.json_dir = self.root / "daily_json"
        self.html_dir = self.root / "daily_html"
        self.state_dir = self.root / "fetch-state"
        self.result_file = self.root / "pipeline-result.json"
        self.now = datetime(2026, 9, 12, 8, tzinfo=timezone.utc)
        self.day = date(2026, 9, 11)
        self.main.PROJECT_ROOT = str(self.root)
        self.main.DEFAULT_JSON_DIR = str(self.json_dir)
        self.main.DEFAULT_HTML_DIR = str(self.html_dir)
        self.main.DEFAULT_SEARCH_INDEX_DIR = str(self.root / "search_index")
        self.main.EARLIEST_DATE = self.day - timedelta(days=1)
        self.main.FetchState = lambda root: self.state(root)
        self.enterContext(mock.patch.object(self.main.time, "sleep"))
        self.main.generate_html_from_json = mock.Mock(side_effect=self.render)
        self.main.prefilter_papers_by_keywords = mock.Mock(side_effect=self.prefilter)
        self.main.filter_and_rate_papers = mock.Mock(side_effect=self.rate)
        self.main.translate_summaries = mock.Mock(side_effect=lambda papers, **_: papers)
        self.main.fetch_cv_papers = mock.Mock(side_effect=self.fetch)

    def state(self, root=None):
        return self.FetchState(root or self.state_dir, now=lambda: self.now)

    def paper(self, day, category):
        return {
            "title": f"Robot {day} {category}",
            "summary": "Robot navigation and control.",
            "url": f"https://arxiv.org/abs/{day}-{category}",
            "published_date": datetime.combine(day, datetime.min.time(), timezone.utc),
            "updated_date": datetime.combine(day, datetime.min.time(), timezone.utc),
            "authors": ["Author"],
            "categories": [category],
        }

    def fetch(self, *, category, specified_date, **_):
        return [self.paper(specified_date, category)]

    @staticmethod
    def prefilter(papers):
        for paper in papers:
            paper["stage1_selected"] = True
        return papers, []

    @staticmethod
    def rate(papers):
        for paper in papers:
            paper.update(ai_processed=True, overall_priority_score=8, topic="VLA")
        return papers

    @staticmethod
    def render(*, json_file_path, output_dir, **_):
        # Match the real renderer's filename contract, exercising staged paths.
        json.loads(Path(json_file_path).read_text(encoding="utf-8"))
        output = Path(output_dir)
        output.mkdir(parents=True, exist_ok=True)
        (output / f"{Path(json_file_path).stem.replace('-', '_')}.html").write_text(
            "<html>Complete report</html>", encoding="utf-8",
        )

    def run_pipeline(self, day=None, **kwargs):
        return self.main.run_pipeline(
            day or self.day,
            state_dir=str(self.state_dir),
            result_file=str(self.result_file),
            **kwargs,
        )

    def assert_no_report(self, day=None):
        day = day or self.day
        self.assertFalse((self.json_dir / f"{day}.json").exists())
        self.assertFalse((self.html_dir / f"{day:%Y_%m_%d}.html").exists())

    def test_category_snapshot_survives_defer_and_new_run_resumes_after_cooldown(self):
        retry_at = self.now + timedelta(hours=2)

        def limited_fetch(*, category, specified_date, **_):
            if category == "cs.AI":
                raise self.scraper.ArxivDeferred("HTTP 429", retry_at)
            return self.fetch(category=category, specified_date=specified_date)

        self.main.fetch_cv_papers.side_effect = limited_fetch
        first = self.run_pipeline()
        self.assertEqual(first["exit_code"], 2)
        self.assertFalse(first["publish_ready"])
        self.assert_no_report()
        self.assertEqual(
            [call.kwargs["category"] for call in self.main.fetch_cv_papers.call_args_list],
            ["cs.RO", "cs.AI"],
        )
        snapshot = self.state().load_snapshot(
            self.day, "cs.RO", self.scraper.build_query("cs.RO", self.day),
        )
        self.assertEqual(len(snapshot), 1)
        self.assertEqual(self.state().pending_dates(), [self.day])

        self.main.fetch_cv_papers.reset_mock()
        self.main.fetch_cv_papers.side_effect = self.fetch
        second = self.run_pipeline()
        self.assertEqual(second["exit_code"], 2)
        self.main.fetch_cv_papers.assert_not_called()
        self.assert_no_report()

        self.now = retry_at + timedelta(seconds=1)
        third = self.run_pipeline()
        self.assertEqual(third["exit_code"], 0)
        self.assertTrue(third["publish_ready"])
        self.assertEqual(third["completed_dates"], [self.day.isoformat()])
        self.assertEqual(
            [call.kwargs["category"] for call in self.main.fetch_cv_papers.call_args_list],
            ["cs.AI", "cs.CV", "cs.LG"],
        )
        report = json.loads((self.json_dir / f"{self.day}.json").read_text())
        self.assertEqual(len(report), 4)
        self.assertTrue(all(paper["ai_processed"] for paper in report))
        # Keep recovery priority until a later checkout confirms the formal report.
        self.assertEqual(self.state().pending_dates(), [self.day])
        self.assertEqual(json.loads(self.result_file.read_text()), third)
        self.main.fetch_cv_papers.reset_mock()
        self.main.filter_and_rate_papers.reset_mock()
        confirmed = self.run_pipeline()
        self.assertEqual(confirmed["exit_code"], 0)
        self.main.fetch_cv_papers.assert_not_called()
        self.main.filter_and_rate_papers.assert_not_called()
        self.assertEqual(self.state().pending_dates(), [])

    def test_ai_failure_reuses_all_four_raw_snapshots_on_next_run(self):
        self.main.filter_and_rate_papers.side_effect = RuntimeError("AI unavailable")
        first = self.run_pipeline()
        self.assertEqual(first["exit_code"], 1)
        self.assertFalse(first["publish_ready"])
        self.assertEqual(self.main.fetch_cv_papers.call_count, 4)
        self.assert_no_report()

        self.main.fetch_cv_papers.reset_mock()
        self.main.filter_and_rate_papers.side_effect = self.rate
        second = self.run_pipeline()
        self.assertEqual(second["exit_code"], 0)
        self.main.fetch_cv_papers.assert_not_called()
        self.assertTrue(second["publish_ready"])

    def test_completed_pending_day_is_publishable_when_target_is_rate_limited(self):
        earlier = self.day - timedelta(days=1)
        self.state().defer(earlier, "cs.RO", self.now - timedelta(seconds=1), "previous 429")

        def fetch_until_target(*, category, specified_date, **_):
            if specified_date == self.day:
                raise self.scraper.ArxivDeferred("HTTP 429", self.now + timedelta(hours=2))
            return self.fetch(category=category, specified_date=specified_date)

        self.main.fetch_cv_papers.side_effect = fetch_until_target
        result = self.run_pipeline(backfill=True)
        self.assertEqual(result["exit_code"], 2)
        self.assertTrue(result["publish_ready"])
        self.assertEqual(result["completed_dates"], [earlier.isoformat()])
        self.assertEqual([task["date"] for task in result["deferred_dates"]], [self.day.isoformat()])
        self.assert_no_report()
        self.assertEqual(self.main.fetch_cv_papers.call_count, 5)
        self.assertEqual(
            [call.kwargs["specified_date"] for call in self.main.fetch_cv_papers.call_args_list],
            [earlier] * 4 + [self.day],
        )
        paths = result["publish_paths"]
        self.assertIn(f"daily_json/{earlier}.json", paths)
        self.assertIn(f"daily_html/{earlier:%Y_%m_%d}.html", paths)
        self.assertIn("reports.json", paths)
        self.assertIn("search_index.json", paths)
        self.assertTrue(any(path == "search_index" or path.startswith("search_index/") for path in paths))
        self.assertNotIn(f"daily_json/{self.day}.json", paths)
        self.assertTrue(all(not Path(path).is_absolute() for path in paths))
        self.assertTrue(all((self.root / path).exists() for path in paths))
        self.assertEqual(json.loads((self.root / "reports.json").read_text()), [f"{earlier:%Y_%m_%d}.html"])
        records = json.loads((self.root / "search_index.json").read_text())
        self.assertEqual({record["date"] for record in records}, {earlier.isoformat()})

    def test_generic_fetch_failure_stops_other_categories_and_backfill(self):
        self.main.fetch_cv_papers.side_effect = self.scraper.ArxivFetchError("invalid feed")
        result = self.run_pipeline(backfill=True)
        self.assertEqual(result["exit_code"], 1)
        self.assertFalse(result["publish_ready"])
        self.main.fetch_cv_papers.assert_called_once()
        self.assert_no_report()

    def test_html_failure_does_not_promote_json_and_next_run_uses_snapshots(self):
        self.main.generate_html_from_json.side_effect = RuntimeError("renderer failed")
        result = self.run_pipeline()
        self.assertEqual(result["exit_code"], 1)
        self.assertFalse(result["publish_ready"])
        self.assert_no_report()
        self.assertFalse((self.root / "reports.json").exists())

        self.main.fetch_cv_papers.reset_mock()
        self.main.generate_html_from_json.side_effect = self.render
        recovered = self.run_pipeline()
        self.assertEqual(recovered["exit_code"], 0)
        self.main.fetch_cv_papers.assert_not_called()

    def test_existing_complete_report_skips_fetch_ai_and_render(self):
        self.run_pipeline()
        self.main.fetch_cv_papers.reset_mock()
        self.main.filter_and_rate_papers.reset_mock()
        self.main.generate_html_from_json.reset_mock()
        result = self.run_pipeline()
        self.assertEqual(result["exit_code"], 0)
        self.main.fetch_cv_papers.assert_not_called()
        self.main.filter_and_rate_papers.assert_not_called()
        self.main.generate_html_from_json.assert_not_called()

    def test_search_index_failure_never_marks_reports_publishable(self):
        with mock.patch.object(self.main, "generate_search_index", side_effect=RuntimeError("index failed")):
            result = self.run_pipeline()
        self.assertEqual(result["exit_code"], 1)
        self.assertFalse(result["publish_ready"])
        self.assertEqual(result["publish_paths"], [])
        self.assertEqual(result["completed_dates"], [self.day.isoformat()])
        self.assertTrue(any("index failed" in task["reason"] for task in result["failures"]))
        self.assertEqual(json.loads(self.result_file.read_text()), result)
        self.assert_no_report()
        self.main.fetch_cv_papers.reset_mock()
        recovered = self.run_pipeline()
        self.assertEqual(recovered["exit_code"], 0)
        self.assertTrue(recovered["publish_ready"])
        self.main.fetch_cv_papers.assert_not_called()
        self.assertEqual(recovered["completed_dates"], [self.day.isoformat()])

    def test_failed_render_of_ai_repair_preserves_existing_json_bytes(self):
        self.json_dir.mkdir()
        original = [{
            "title": "Previously unrated", "summary": "Robot control",
            "url": "https://arxiv.org/abs/2609.12345", "stage1_selected": True,
            "ai_processed": False,
        }]
        report_path = self.json_dir / f"{self.day}.json"
        report_path.write_text(json.dumps(original), encoding="utf-8")
        before = report_path.read_bytes()
        self.main.generate_html_from_json.side_effect = RuntimeError("renderer failed")
        result = self.run_pipeline()
        self.assertEqual(result["exit_code"], 1)
        self.assertFalse(result["publish_ready"])
        self.assertEqual(report_path.read_bytes(), before)
        self.assertFalse((self.html_dir / f"{self.day:%Y_%m_%d}.html").exists())
        self.main.fetch_cv_papers.assert_not_called()

    def test_index_promotion_failure_restores_previous_reports_and_indexes(self):
        earlier = self.day - timedelta(days=1)
        self.assertTrue(self.run_pipeline(earlier)["publish_ready"])
        published_paths = [
            self.json_dir / f"{earlier}.json",
            self.html_dir / f"{earlier:%Y_%m_%d}.html",
            self.root / "reports.json",
            self.root / "search_index.json",
            *sorted((self.root / "search_index").glob("*.json")),
        ]
        baseline = {path: path.read_bytes() for path in published_paths}
        real_replace = self.main.os.replace
        failed = False

        def replace_once(source, destination):
            nonlocal failed
            if not failed and Path(destination) == self.root / "search_index.json":
                failed = True
                raise OSError("cannot promote legacy index")
            return real_replace(source, destination)

        with mock.patch.object(self.main.os, "replace", side_effect=replace_once):
            result = self.run_pipeline()
        self.assertTrue(failed)
        self.assertEqual(result["exit_code"], 1)
        self.assertFalse(result["publish_ready"])
        self.assert_no_report()
        for path, original in baseline.items():
            self.assertEqual(path.read_bytes(), original, str(path))
        self.main.fetch_cv_papers.reset_mock()
        recovered = self.run_pipeline()
        self.assertEqual(recovered["exit_code"], 0)
        self.assertTrue(recovered["publish_ready"])
        self.main.fetch_cv_papers.assert_not_called()

    def test_four_successful_empty_categories_publish_valid_empty_report(self):
        self.main.fetch_cv_papers.side_effect = None
        self.main.fetch_cv_papers.return_value = []
        result = self.run_pipeline()
        self.assertEqual(result["exit_code"], 0)
        self.assertTrue(result["publish_ready"])
        self.assertEqual(self.main.fetch_cv_papers.call_count, 4)
        self.main.filter_and_rate_papers.assert_not_called()
        self.assertEqual(json.loads((self.json_dir / f"{self.day}.json").read_text()), [])

    def test_query_window_is_unchanged_and_snapshot_query_mismatch_refetches(self):
        expected = "cat:cs.RO AND submittedDate:[202609091800 TO 202609101800]"
        self.assertEqual(self.scraper.build_query("cs.RO", self.day), expected)
        self.state().save_snapshot(self.day, "cs.RO", "old query", [self.paper(self.day, "cs.RO")])
        result = self.run_pipeline()
        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(self.main.fetch_cv_papers.call_count, 4)


if __name__ == "__main__":
    unittest.main()
