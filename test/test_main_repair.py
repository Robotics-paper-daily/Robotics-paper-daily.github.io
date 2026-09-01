"""Tests for detecting and repairing reports whose entire AI phase failed."""

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from datetime import date
from pathlib import Path
from unittest import mock


SRC_DIR = Path(__file__).resolve().parents[1] / "src"


def load_main_module():
    scraper = types.ModuleType("scraper")
    scraper.fetch_cv_papers = mock.Mock()

    filter_module = types.ModuleType("filter")
    filter_module.prefilter_papers_by_keywords = mock.Mock()
    filter_module.filter_and_rate_papers = mock.Mock()
    filter_module.translate_summaries = mock.Mock()

    html_generator = types.ModuleType("html_generator")
    html_generator.generate_html_from_json = mock.Mock()

    config = types.ModuleType("config")
    config.TRANSLATION_MIN_SCORE = 7

    search_index = types.ModuleType("search_index")
    search_index.generate_search_index = mock.Mock()

    dependencies = {
        "scraper": scraper,
        "filter": filter_module,
        "html_generator": html_generator,
        "config": config,
        "search_index": search_index,
    }
    spec = importlib.util.spec_from_file_location("main_repair_under_test", SRC_DIR / "main.py")
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, dependencies):
        spec.loader.exec_module(module)
    return module, scraper


class ReportRepairTests(unittest.TestCase):
    def setUp(self):
        self.main, self.scraper = load_main_module()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.json_dir = self.root / "daily_json"
        self.html_dir = self.root / "daily_html"
        self.json_dir.mkdir()
        self.html_dir.mkdir()
        self.main.PROJECT_ROOT = str(self.root)
        self.main.DEFAULT_JSON_DIR = str(self.json_dir)
        self.main.DEFAULT_HTML_DIR = str(self.html_dir)

        def render_report(*, json_file_path, output_dir, **_):
            output = Path(output_dir)
            output.mkdir(parents=True, exist_ok=True)
            filename = f"{Path(json_file_path).stem.replace('-', '_')}.html"
            (output / filename).write_text("<html></html>", encoding="utf-8")

        self.main.generate_html_from_json = mock.Mock(side_effect=render_report)

    def tearDown(self):
        self.temp_dir.cleanup()

    def write_report(self, day, papers):
        path = self.json_dir / f"{day.isoformat()}.json"
        path.write_text(json.dumps(papers), encoding="utf-8")
        return path

    def test_detects_zero_of_n_but_not_healthy_or_stage1_empty_reports(self):
        failed = self.write_report(
            date(2026, 8, 29),
            [{"stage1_selected": True, "ai_processed": False}],
        )
        healthy = self.write_report(
            date(2026, 8, 30),
            [
                {
                    "stage1_selected": True,
                    "ai_processed": True,
                    "overall_priority_score": 8,
                }
            ],
        )
        stage1_empty = self.write_report(
            date(2026, 8, 31),
            [{"stage1_selected": False, "ai_processed": False}],
        )
        incomplete = self.write_report(
            date(2026, 9, 1),
            [{"stage1_selected": True, "ai_processed": True}],
        )

        self.assertTrue(self.main.report_needs_ai_repair(str(failed)))
        self.assertFalse(self.main.report_needs_ai_repair(str(healthy)))
        self.assertFalse(self.main.report_needs_ai_repair(str(stage1_empty)))
        self.assertTrue(self.main.report_needs_ai_repair(str(incomplete)))

    def test_finds_existing_failed_dates_alongside_missing_dates(self):
        self.write_report(
            date(2026, 8, 29),
            [{"stage1_selected": True, "ai_processed": False}],
        )
        self.write_report(
            date(2026, 8, 31),
            [
                {
                    "stage1_selected": True,
                    "ai_processed": True,
                    "overall_priority_score": 8,
                }
            ],
        )

        self.assertEqual(
            self.main.find_failed_ai_dates(
                str(self.json_dir),
                date(2026, 8, 29),
                date(2026, 8, 31),
            ),
            [date(2026, 8, 29)],
        )
        self.assertEqual(
            self.main.find_missing_dates(
                str(self.json_dir),
                date(2026, 8, 29),
                date(2026, 8, 31),
            ),
            [date(2026, 8, 30)],
        )

    def test_main_repairs_existing_report_without_refetching_arxiv(self):
        target = date(2026, 8, 29)
        report = self.write_report(
            target,
            [
                {
                    "title": "Selected",
                    "summary": "Abstract",
                    "stage1_selected": True,
                    "ai_processed": False,
                },
                {
                    "title": "Rejected",
                    "stage1_selected": False,
                    "ai_processed": False,
                },
            ],
        )

        def rate(papers):
            papers[0]["ai_processed"] = True
            papers[0]["overall_priority_score"] = 9
            return papers

        self.main.filter_and_rate_papers = mock.Mock(side_effect=rate)
        self.main.translate_summaries = mock.Mock(side_effect=lambda papers, **_: papers)

        self.main.main(target)

        repaired = json.loads(report.read_text(encoding="utf-8"))
        self.assertTrue(repaired[0]["ai_processed"])
        self.assertEqual(repaired[0]["overall_priority_score"], 9)
        self.assertEqual(repaired[1]["title"], "Rejected")
        self.scraper.fetch_cv_papers.assert_not_called()

    def test_failed_repair_does_not_overwrite_existing_report(self):
        target = date(2026, 8, 29)
        report = self.write_report(
            target,
            [{"title": "Selected", "stage1_selected": True, "ai_processed": False}],
        )
        original = report.read_bytes()
        self.main.filter_and_rate_papers = mock.Mock(
            side_effect=RuntimeError("provider unavailable")
        )

        with self.assertRaisesRegex(RuntimeError, "provider unavailable"):
            self.main.main(target)

        self.assertEqual(report.read_bytes(), original)

    def test_html_generation_failure_propagates(self):
        target = date(2026, 8, 29)
        self.write_report(
            target,
            [
                {
                    "title": "Healthy",
                    "stage1_selected": True,
                    "ai_processed": True,
                    "overall_priority_score": 8,
                }
            ],
        )
        self.main.generate_html_from_json = mock.Mock(
            side_effect=RuntimeError("renderer failed")
        )

        with self.assertRaisesRegex(RuntimeError, "renderer failed"):
            self.main.main(target)

        self.assertFalse((self.root / "reports.json").exists())

    def test_successful_empty_arxiv_queries_create_an_empty_report(self):
        target = date(2026, 8, 29)
        self.main.fetch_cv_papers = mock.Mock(return_value=[])
        self.main.prefilter_papers_by_keywords = mock.Mock(return_value=([], []))
        self.main.translate_summaries = mock.Mock(side_effect=lambda papers, **_: papers)

        with mock.patch.object(self.main.time, "sleep"):
            self.main.main(target)

        report = self.json_dir / "2026-08-29.json"
        self.assertEqual(json.loads(report.read_text(encoding="utf-8")), [])
        self.assertEqual(self.main.fetch_cv_papers.call_count, 4)
        self.main.filter_and_rate_papers.assert_not_called()

    def test_atomic_json_replace_failure_preserves_old_file_and_cleans_temp(self):
        report = self.json_dir / "2026-08-29.json"
        report.write_text('[{"old": true}]', encoding="utf-8")

        with mock.patch.object(
            self.main.os,
            "replace",
            side_effect=OSError("replace failed"),
        ):
            with self.assertRaisesRegex(OSError, "replace failed"):
                self.main._write_json_atomic(str(report), [{"new": True}])

        self.assertEqual(report.read_text(encoding="utf-8"), '[{"old": true}]')
        self.assertEqual(list(self.json_dir.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
