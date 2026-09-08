"""Offline HTTP retry tests using the real arxiv parser and pagination."""

import importlib.util
import unittest
from datetime import date, datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlparse
from xml.etree import ElementTree as ET

import arxiv
import requests


SPEC = importlib.util.spec_from_file_location(
    "scraper_transport_under_test",
    Path(__file__).resolve().parents[1] / "src" / "scraper.py",
)
scraper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scraper)
API_URL = "https://export.arxiv.org/api/query?search_query=cat%3Acs.RO"
ATOM = "http://www.w3.org/2005/Atom"
OPENSEARCH = "http://a9.com/-/spec/opensearch/1.1/"


def response(status=200, content=b"", headers=None):
    result = requests.Response()
    result.status_code = status
    result._content = content
    result._content_consumed = True
    result.headers.update(headers or {})
    result.close = mock.Mock(wraps=result.close)
    return result


def feed_response(titles=(), total=None, start=0):
    feed = ET.Element(f"{{{ATOM}}}feed")
    fields = {
        "totalResults": len(titles) if total is None else total,
        "itemsPerPage": len(titles),
        "startIndex": start,
    }
    for key, value in fields.items():
        ET.SubElement(feed, f"{{{OPENSEARCH}}}{key}").text = str(value)
    for index, title in enumerate(titles, start):
        entry = ET.SubElement(feed, f"{{{ATOM}}}entry")
        for key, value in {
            "id": f"https://arxiv.org/abs/2609.{index:05d}",
            "title": title,
            "summary": " Abstract ",
            "published": "2026-09-01T18:00:00Z",
            "updated": "2026-09-01T18:00:00Z",
        }.items():
            ET.SubElement(entry, f"{{{ATOM}}}{key}").text = value
        author = ET.SubElement(entry, f"{{{ATOM}}}author")
        ET.SubElement(author, f"{{{ATOM}}}name").text = "Author"
        ET.SubElement(entry, f"{{{ATOM}}}category", term="cs.RO")
    return response(content=ET.tostring(feed, encoding="utf-8"))


class ArxivTransportTests(unittest.TestCase):
    def setUp(self):
        self.elapsed = 0.0
        self.sleep = self.enterContext(
            mock.patch.object(scraper.time, "sleep", side_effect=self.advance)
        )
        self.enterContext(
            mock.patch.object(scraper.time, "monotonic", side_effect=lambda: self.elapsed)
        )
        self.enterContext(mock.patch.object(scraper.random, "uniform", return_value=0))
        clock = self.enterContext(mock.patch.object(arxiv, "datetime", wraps=datetime))
        clock.now.side_effect = lambda: datetime(2026, 9, 8) + timedelta(seconds=self.elapsed)
        self.request = self.enterContext(mock.patch.object(requests.Session, "request"))
        self.close = self.enterContext(mock.patch.object(requests.Session, "close", autospec=True))

    def advance(self, seconds):
        self.elapsed += seconds

    def get(self):
        with scraper._ArxivSession() as session:
            return session.get(API_URL)

    def fetch(self):
        return scraper.fetch_cv_papers(category="cs.RO", specified_date=date(2026, 9, 8))

    def waits(self):
        return [call.args[0] for call in self.sleep.call_args_list]

    def test_429_recovers_with_timeout_and_nonzero_first_backoff(self):
        limited = response(429)
        successful = response()
        self.request.side_effect = [limited, successful]
        self.assertIs(self.get(), successful)
        self.assertEqual(self.waits(), [60])
        self.assertEqual(self.request.call_count, 2)
        for call in self.request.call_args_list:
            self.assertEqual(call.args, ("GET", API_URL))
            self.assertEqual(call.kwargs["timeout"], (10, 90))
            self.assertIs(call.kwargs["stream"], False)
        limited.close.assert_called_once()
        self.close.assert_called_once()

    def test_retry_after_seconds_respected(self):
        self.request.side_effect = [response(429, headers={"Retry-After": "180"}), response()]
        self.get()
        self.assertEqual(self.waits(), [180])

    def test_short_retry_after_does_not_reduce_backoff(self):
        self.request.side_effect = [response(429, headers={"Retry-After": "1"}), response()]
        self.get()
        self.assertEqual(self.waits(), [60])

    def test_jitter_is_added_without_shortening_server_cooldown(self):
        self.request.side_effect = [
            response(429), response(429, headers={"Retry-After": "180"}), response(),
        ]
        with mock.patch.object(scraper.random, "uniform", return_value=7):
            self.get()
        self.assertEqual(self.waits(), [67, 180])

    def test_retry_after_http_date_respected(self):
        now = datetime(2026, 9, 8, tzinfo=timezone.utc)
        header = format_datetime(now + timedelta(seconds=180), usegmt=True)
        self.request.side_effect = [response(429, headers={"Retry-After": header}), response()]
        with mock.patch.object(scraper, "datetime", wraps=datetime) as clock:
            clock.now.return_value = now
            self.get()
        self.assertEqual(self.waits(), [180])

    def test_invalid_retry_after_uses_backoff(self):
        self.request.side_effect = [response(429, headers={"Retry-After": "invalid"}), response()]
        self.get()
        self.assertEqual(self.waits(), [60])

    def test_long_retry_after_stops_without_retrying_early(self):
        limited = response(429, headers={"Retry-After": "3600"})
        self.request.return_value = limited
        with self.assertRaisesRegex(scraper.ArxivFetchError, "required cooldown 3600.0s"):
            self.get()
        self.request.assert_called_once()
        self.sleep.assert_not_called()
        limited.close.assert_called_once()
        self.close.assert_called_once()

    def test_request_duration_reduces_remaining_retry_budget(self):
        def slow_request(*args, **kwargs):
            self.advance(850)
            return response(429, headers={"Retry-After": "60"})

        self.request.side_effect = slow_request
        with self.assertRaisesRegex(scraper.ArxivFetchError, "exceeds remaining retry budget"):
            self.get()
        self.request.assert_called_once()
        self.sleep.assert_not_called()

    def test_cooldown_exactly_at_budget_does_not_start_an_extra_request(self):
        self.request.return_value = response(429, headers={"Retry-After": "900"})
        with self.assertRaisesRegex(scraper.ArxivFetchError, "exceeds remaining retry budget"):
            self.get()
        self.request.assert_called_once()
        self.sleep.assert_not_called()

    def test_timeout_and_body_connection_error_recover(self):
        successful = response()
        self.request.side_effect = [
            requests.ReadTimeout("waiting for headers"),
            requests.ConnectionError("response body read timed out"),
            successful,
        ]
        self.assertIs(self.get(), successful)
        self.assertEqual(self.waits(), [60, 120])

    def test_transient_statuses_retry(self):
        for status in (408, 500, 502, 503, 504):
            with self.subTest(status=status):
                self.request.reset_mock()
                self.sleep.reset_mock()
                successful = response()
                self.request.side_effect = [response(status), successful]
                self.assertIs(self.get(), successful)
                self.assertEqual(self.waits(), [60])

    def test_permanent_http_error_is_not_retried(self):
        self.request.return_value = response(403)
        with self.assertRaisesRegex(scraper.ArxivFetchError, "HTTP 403"):
            self.fetch()
        self.request.assert_called_once()
        self.sleep.assert_not_called()

    def test_continuous_429_is_exactly_five_requests_without_outer_retries(self):
        limited = [response(429) for _ in range(5)]
        self.request.side_effect = limited
        with self.assertRaisesRegex(scraper.ArxivFetchError, "after 5 attempts: HTTP 429"):
            self.fetch()
        self.assertEqual(self.request.call_count, 5)
        self.assertEqual(self.waits(), [60, 120, 240, 300])
        for item in limited:
            item.close.assert_called_once()
        self.assertEqual(self.close.call_count, 2)
        self.assertIsInstance(self.close.call_args.args[0], scraper._ArxivSession)

    def test_second_page_retry_does_not_repeat_first_page(self):
        self.request.side_effect = [
            feed_response(["First"], total=2),
            response(429),
            feed_response(["Second"], total=2, start=1),
        ]
        papers = self.fetch()
        self.assertEqual([paper["title"] for paper in papers], ["First", "Second"])
        urls = [call.args[1] for call in self.request.call_args_list]
        starts = [parse_qs(urlparse(url).query)["start"] for url in urls]
        self.assertEqual(starts, [["0"], ["1"], ["1"]])
        self.assertEqual(urls[1], urls[2])
        self.assertEqual(self.waits(), [10, 60])
        self.assertEqual(self.close.call_count, 2)

    def test_429_recovery_preserves_three_successful_empty_confirmations(self):
        self.request.side_effect = [response(429), feed_response(), feed_response(), feed_response()]
        self.assertEqual(self.fetch(), [])
        self.assertEqual(self.request.call_count, 4)
        self.assertEqual(self.waits(), [60, 30, 60])
        self.assertEqual(self.close.call_count, 2)

    def test_successful_fetch_closes_injected_session(self):
        self.request.return_value = feed_response(["Paper"])
        self.assertEqual(self.fetch()[0]["authors"], ["Author"])
        self.assertEqual(self.close.call_count, 2)
        self.assertIsInstance(self.close.call_args.args[0], scraper._ArxivSession)


if __name__ == "__main__":
    unittest.main()
