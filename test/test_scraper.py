"""Tests that distinguish valid empty arXiv results from client failures."""

import importlib.util
import sys
import types
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock


SRC_DIR = Path(__file__).resolve().parents[1] / "src"


class FakeHTTPError(Exception):
    pass


class FakeUnexpectedEmptyPageError(Exception):
    pass


def load_scraper_module():
    client = mock.Mock()
    arxiv = types.ModuleType("arxiv")
    arxiv.Client = mock.Mock(return_value=client)
    arxiv.Search = mock.Mock(return_value=object())
    arxiv.SortCriterion = types.SimpleNamespace(SubmittedDate="submitted")
    arxiv.HTTPError = FakeHTTPError
    arxiv.UnexpectedEmptyPageError = FakeUnexpectedEmptyPageError

    spec = importlib.util.spec_from_file_location("scraper_under_test", SRC_DIR / "scraper.py")
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, {"arxiv": arxiv}):
        spec.loader.exec_module(module)
    return module, client


def fake_result(title="Paper"):
    return types.SimpleNamespace(
        title=title,
        summary=" Abstract ",
        entry_id="https://arxiv.org/abs/2608.00001",
        published=datetime(2026, 8, 29),
        updated=datetime(2026, 8, 29),
        categories=["cs.RO"],
        authors=[types.SimpleNamespace(name="Author")],
    )


class ScraperFailureContractTests(unittest.TestCase):
    def setUp(self):
        self.scraper, self.client = load_scraper_module()

    def fetch(self):
        return self.scraper.fetch_cv_papers(
            category="cs.RO",
            specified_date=date(2026, 8, 29),
        )

    def test_successful_empty_query_returns_empty_list(self):
        self.client.results.return_value = []
        with mock.patch.object(self.scraper.time, "sleep") as sleep:
            self.assertEqual(self.fetch(), [])
        self.assertEqual(self.client.results.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [30, 60])

    def test_transient_empty_first_page_can_recover(self):
        self.client.results.side_effect = [[], [fake_result()]]
        with mock.patch.object(self.scraper.time, "sleep") as sleep:
            papers = self.fetch()

        self.assertEqual([paper["title"] for paper in papers], ["Paper"])
        sleep.assert_called_once_with(30)

    def test_http_failures_retry_and_can_recover(self):
        self.client.results.side_effect = [
            FakeHTTPError("429"),
            FakeHTTPError("503"),
            [fake_result()],
        ]
        with mock.patch.object(self.scraper.time, "sleep") as sleep:
            papers = self.fetch()

        self.assertEqual([paper["title"] for paper in papers], ["Paper"])
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [30, 60])

    def test_http_retry_exhaustion_raises_instead_of_returning_empty(self):
        self.client.results.side_effect = [
            FakeHTTPError("503"),
            FakeHTTPError("503"),
            FakeHTTPError("503"),
        ]
        with mock.patch.object(self.scraper.time, "sleep"):
            with self.assertRaises(self.scraper.ArxivFetchError):
                self.fetch()

    def test_final_empty_after_http_failures_is_not_confirmed(self):
        self.client.results.side_effect = [
            FakeHTTPError("503"),
            FakeHTTPError("503"),
            [],
        ]
        with mock.patch.object(self.scraper.time, "sleep"):
            with self.assertRaises(self.scraper.ArxivFetchError):
                self.fetch()

    def test_unexpected_empty_page_retry_exhaustion_raises(self):
        self.client.results.side_effect = [
            FakeUnexpectedEmptyPageError("empty"),
            FakeUnexpectedEmptyPageError("empty"),
            FakeUnexpectedEmptyPageError("empty"),
        ]
        with mock.patch.object(self.scraper.time, "sleep"):
            with self.assertRaises(self.scraper.ArxivFetchError):
                self.fetch()

    def test_partial_page_is_discarded_before_retry(self):
        def partial_results():
            yield fake_result("Partial")
            raise FakeHTTPError("503")

        self.client.results.side_effect = [
            partial_results(),
            [fake_result("Recovered")],
        ]
        with mock.patch.object(self.scraper.time, "sleep"):
            papers = self.fetch()

        self.assertEqual([paper["title"] for paper in papers], ["Recovered"])

    def test_unknown_client_error_raises_without_retrying(self):
        self.client.results.side_effect = ValueError("broken wrapper")
        with mock.patch.object(self.scraper.time, "sleep") as sleep:
            with self.assertRaisesRegex(
                self.scraper.ArxivFetchError,
                "Unexpected arXiv client failure",
            ):
                self.fetch()
        self.client.results.assert_called_once()
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
