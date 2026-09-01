"""Atomic publication tests for generated daily HTML."""

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


SRC_DIR = Path(__file__).resolve().parents[1] / "src"


def load_html_generator():
    class Template:
        def render(self, **_):
            return "<html>new report</html>"

    class Environment:
        def __init__(self, **_):
            pass

        def get_template(self, _):
            return Template()

    jinja2 = types.ModuleType("jinja2")
    jinja2.Environment = Environment
    jinja2.FileSystemLoader = lambda _: object()

    config = types.ModuleType("config")
    config.SCORE_THRESHOLD = 7

    spec = importlib.util.spec_from_file_location(
        "html_generator_under_test",
        SRC_DIR / "html_generator.py",
    )
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, {"jinja2": jinja2, "config": config}):
        spec.loader.exec_module(module)
    return module


class HTMLGeneratorAtomicWriteTests(unittest.TestCase):
    def setUp(self):
        self.generator = load_html_generator()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.output = self.root / "daily_html"
        self.output.mkdir()
        self.source = self.root / "2026-08-29.json"
        self.source.write_text(json.dumps([]), encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    def generate(self):
        self.generator.generate_html_from_json(
            json_file_path=str(self.source),
            template_dir=str(self.root),
            template_name="paper_template.html",
            output_dir=str(self.output),
        )

    def test_generates_expected_daily_html(self):
        self.generate()
        self.assertEqual(
            (self.output / "2026_08_29.html").read_text(encoding="utf-8"),
            "<html>new report</html>",
        )

    def test_replace_failure_preserves_old_html_and_cleans_temp(self):
        report = self.output / "2026_08_29.html"
        report.write_text("old report", encoding="utf-8")

        with mock.patch.object(
            self.generator.os,
            "replace",
            side_effect=OSError("replace failed"),
        ):
            with self.assertRaisesRegex(OSError, "replace failed"):
                self.generate()

        self.assertEqual(report.read_text(encoding="utf-8"), "old report")
        self.assertEqual(list(self.output.glob("*.tmp")), [])

    def test_missing_json_raises_instead_of_reusing_old_html(self):
        self.source.unlink()
        with self.assertRaises(FileNotFoundError):
            self.generate()


if __name__ == "__main__":
    unittest.main()
