import json
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from search_index import SearchIndexError, generate_search_index  # noqa: E402


class SearchIndexGeneratorTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.sources = self.root / "daily_json"
        self.output = self.root / "search_index"
        self.legacy = self.root / "search_index.json"
        self.sources.mkdir()

    def tearDown(self):
        self.temp_dir.cleanup()

    def write_day(self, date, papers):
        (self.sources / f"{date}.json").write_text(
            json.dumps(papers, ensure_ascii=False), encoding="utf-8"
        )

    def test_generates_ordered_full_shards_and_selected_legacy_index(self):
        self.write_day(
            "2026-01-31",
            [
                {
                    "title": "Older selected",
                    "summary": "English abstract",
                    "summary_zh": "中文摘要",
                    "url": "https://example.test/1",
                    "authors": ["A"],
                    "categories": ["cs.RO"],
                    "stage1_selected": True,
                    "keywords": ["unused"],
                }
            ],
        )
        self.write_day(
            "2026-02-01",
            [
                {
                    "title": "Rejected but searchable",
                    "summary": "Full history remains searchable",
                    "url": "https://example.test/2",
                    "authors": ["B"],
                    "categories": ["cs.AI"],
                    "stage1_selected": False,
                },
                {
                    "title": "Newer selected",
                    "summary": "Another abstract",
                    "url": "https://example.test/3",
                    "authors": ["C"],
                    "categories": ["cs.CV"],
                },
            ],
        )
        self.output.mkdir()
        (self.output / "2026-01-999.json").write_text("[]", encoding="utf-8")
        (self.output / "notes.json").write_text("{}", encoding="utf-8")

        manifest = generate_search_index(self.sources, self.output, self.legacy)

        self.assertEqual(manifest["total"], 3)
        self.assertEqual([s["file"] for s in manifest["shards"]], ["2026-01.json", "2026-02.json"])
        papers = []
        for shard in manifest["shards"]:
            papers.extend(json.loads((self.output / shard["file"]).read_text(encoding="utf-8")))
            self.assertEqual((self.output / shard["file"]).stat().st_size, shard["bytes"])
        self.assertEqual([paper["title"] for paper in papers], ["Older selected", "Rejected but searchable", "Newer selected"])
        self.assertNotIn("keywords", papers[0])
        self.assertNotIn("selected", papers[0])
        self.assertFalse((self.output / "2026-01-999.json").exists())
        self.assertTrue((self.output / "notes.json").exists())

        legacy = json.loads(self.legacy.read_text(encoding="utf-8"))
        self.assertEqual([paper["title"] for paper in legacy], ["Older selected", "Newer selected"])
        self.assertEqual(manifest["legacy"]["count"], 2)

    def test_splits_oversized_month_and_bounds_legacy_to_newest(self):
        papers = [
            {
                "title": f"Paper {index}",
                "summary": "x" * 80,
                "url": f"https://example.test/{index}",
                "stage1_selected": True,
            }
            for index in range(5)
        ]
        self.write_day("2026-03-01", papers)

        manifest = generate_search_index(
            self.sources,
            self.output,
            self.legacy,
            max_shard_bytes=350,
            legacy_max_bytes=350,
        )

        self.assertGreater(len(manifest["shards"]), 1)
        self.assertTrue(all(shard["bytes"] <= 350 for shard in manifest["shards"]))
        legacy = json.loads(self.legacy.read_text(encoding="utf-8"))
        self.assertLess(len(legacy), len(papers))
        self.assertEqual(legacy[-1]["title"], "Paper 4")
        self.assertLessEqual(self.legacy.stat().st_size, 350)

    def test_malformed_source_fails_instead_of_publishing_partial_index(self):
        (self.sources / "2026-04-01.json").write_text("{broken", encoding="utf-8")
        with self.assertRaises(SearchIndexError):
            generate_search_index(self.sources, self.output, self.legacy)

    def test_refuses_to_write_generated_files_into_source_directory(self):
        self.write_day("2026-05-01", [])
        with self.assertRaises(SearchIndexError):
            generate_search_index(self.sources, self.sources, self.legacy)
        self.assertTrue((self.sources / "2026-05-01.json").exists())

    def test_preserves_unrelated_temp_files_in_output_directory(self):
        self.write_day("2026-06-01", [])
        self.output.mkdir()
        unrelated = self.output / "notes.tmp"
        unrelated.write_text("keep", encoding="utf-8")
        generate_search_index(self.sources, self.output, self.legacy)
        self.assertEqual(unrelated.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
