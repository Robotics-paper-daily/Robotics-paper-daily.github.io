"""Failure-contract tests for the report pipeline's LLM API client."""

import importlib.util
import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


class FakeRequestException(Exception):
    pass


class FakeHTTPError(FakeRequestException):
    def __init__(self, response=None):
        super().__init__(f"HTTP {getattr(response, 'status_code', 0)}")
        self.response = response


class FakeTimeout(FakeRequestException):
    pass


class FakeConnectionError(FakeRequestException):
    pass


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self.payload = payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise FakeHTTPError(response=self)

    def json(self):
        return self.payload


def load_filter_module():
    requests = types.ModuleType("requests")
    requests.post = mock.Mock()
    requests.exceptions = types.SimpleNamespace(
        HTTPError=FakeHTTPError,
        Timeout=FakeTimeout,
        ConnectionError=FakeConnectionError,
        RequestException=FakeRequestException,
    )
    spec = importlib.util.spec_from_file_location("filter_api_under_test", SRC_DIR / "filter.py")
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, {"requests": requests}):
        spec.loader.exec_module(module)
    return module, requests


class FilterAPIFailureContractTests(unittest.TestCase):
    def setUp(self):
        self.filter, self.requests = load_filter_module()
        self.filter.DEEPSEEK_API_KEY = "test-secret-that-must-not-leak"
        self.filter.DEEPSEEK_API_BASE = (
            "https://url-user:url-password@gateway.example.test/v1?token=url-token"
        )
        self.filter.DEEPSEEK_API_URL = (
            "https://gateway.example.test/v1/chat/completions"
        )
        self.filter.MODEL_NAME = "test-model"

    def test_401_fails_immediately_without_exposing_key(self):
        self.requests.post.return_value = FakeResponse(401)

        with self.assertRaises(self.filter.LLMConfigurationError) as raised:
            self.filter.call_llm_api("prompt", max_retries=4)

        self.assertEqual(self.requests.post.call_count, 1)
        message = str(raised.exception)
        self.assertIn("HTTP 401", message)
        self.assertIn("gateway.example.test", message)
        self.assertNotIn(self.filter.DEEPSEEK_API_KEY, message)
        self.assertNotIn("url-user", message)
        self.assertNotIn("url-password", message)
        self.assertNotIn("url-token", message)

    def test_retryable_server_error_can_recover(self):
        success = FakeResponse(
            200,
            {"choices": [{"message": {"content": "ok"}}]},
        )
        self.requests.post.side_effect = [FakeResponse(503), success]

        with mock.patch.object(self.filter.time, "sleep") as sleep:
            with mock.patch.object(self.filter.random, "uniform", return_value=0):
                result = self.filter.call_llm_api(
                    "prompt",
                    max_retries=1,
                    base_delay=0.01,
                )

        self.assertEqual(result, "ok")
        self.assertEqual(self.requests.post.call_count, 2)
        sleep.assert_called_once()

    def test_other_request_error_logs_only_type_and_safe_origin(self):
        sensitive_url = self.filter.DEEPSEEK_API_BASE
        self.requests.post.side_effect = FakeRequestException(
            f"request failed for {sensitive_url}"
        )

        with self.assertLogs(level="WARNING") as logs:
            result = self.filter.call_llm_api("prompt", max_retries=0)

        output = "\n".join(logs.output)
        self.assertIsNone(result)
        self.assertIn("FakeRequestException", output)
        self.assertIn("https://gateway.example.test", output)
        self.assertNotIn("url-user", output)
        self.assertNotIn("url-password", output)
        self.assertNotIn("url-token", output)

    def test_all_ratings_failed_stops_report_publication(self):
        papers = [{"title": "Paper", "summary": "Abstract"}]
        with mock.patch.object(self.filter, "call_llm_api", return_value=None):
            with self.assertRaises(self.filter.LLMUnavailableError):
                self.filter.filter_and_rate_papers(papers)
        self.assertIs(papers[0]["ai_processed"], False)

    def test_200_with_incomplete_rating_schema_stops_publication(self):
        self.requests.post.return_value = FakeResponse(
            200,
            {"choices": [{"message": {"content": "{}"}}]},
        )
        papers = [{"title": "Paper", "summary": "Abstract"}]

        with self.assertRaises(self.filter.LLMUnavailableError):
            self.filter.filter_and_rate_papers(papers)

        self.assertIs(papers[0]["ai_processed"], False)

    def test_200_with_present_but_invalid_rating_values_stops_publication(self):
        invalid = {
            "tldr": "",
            "tldr_zh": None,
            "topic": "",
            "keywords": [],
            "relevance_score": None,
            "novelty_claim_score": 0,
            "clarity_score": 11,
            "potential_impact_score": False,
            "overall_priority_score": "not-a-score",
        }
        self.requests.post.return_value = FakeResponse(
            200,
            {"choices": [{"message": {"content": json.dumps(invalid)}}]},
        )
        papers = [{"title": "Paper", "summary": "Abstract"}]

        with self.assertRaises(self.filter.LLMUnavailableError):
            self.filter.filter_and_rate_papers(papers)

        self.assertIs(papers[0]["ai_processed"], False)

    def test_unknown_topic_stops_publication(self):
        invalid = {
            "tldr": "Summary",
            "tldr_zh": "摘要",
            "topic": "invented-topic",
            "keywords": ["robotics"],
            "relevance_score": 9,
            "novelty_claim_score": 8,
            "clarity_score": 8,
            "potential_impact_score": 9,
            "overall_priority_score": 9,
        }
        self.requests.post.return_value = FakeResponse(
            200,
            {"choices": [{"message": {"content": json.dumps(invalid)}}]},
        )
        papers = [{"title": "Paper", "summary": "Abstract"}]

        with self.assertRaises(self.filter.LLMUnavailableError):
            self.filter.filter_and_rate_papers(papers)

    def test_mixed_string_and_non_string_keywords_stop_publication(self):
        invalid = {
            "tldr": "Summary",
            "tldr_zh": "摘要",
            "topic": "VLA",
            "keywords": ["robotics", None, {}],
            "relevance_score": 9,
            "novelty_claim_score": 8,
            "clarity_score": 8,
            "potential_impact_score": 9,
            "overall_priority_score": 9,
        }
        self.requests.post.return_value = FakeResponse(
            200,
            {"choices": [{"message": {"content": json.dumps(invalid)}}]},
        )
        papers = [{"title": "Paper", "summary": "Abstract"}]

        with self.assertRaises(self.filter.LLMUnavailableError):
            self.filter.filter_and_rate_papers(papers)

    def test_partial_rating_failure_stops_before_publication(self):
        valid = {
            "tldr": "Summary",
            "tldr_zh": "摘要",
            "topic": "VLA",
            "keywords": ["robotics"],
            "relevance_score": 9,
            "novelty_claim_score": 8,
            "clarity_score": 8,
            "potential_impact_score": 9,
            "overall_priority_score": 9,
        }
        papers = [
            {"title": "First", "summary": "Abstract"},
            {"title": "Second", "summary": "Abstract"},
        ]
        with mock.patch.object(
            self.filter,
            "call_llm_api",
            side_effect=[json.dumps(valid), None],
        ):
            with self.assertRaises(self.filter.LLMUnavailableError):
                self.filter.filter_and_rate_papers(papers)

        self.assertIs(papers[0]["ai_processed"], True)
        self.assertIs(papers[1]["ai_processed"], False)

    def test_missing_key_is_a_configuration_error(self):
        self.filter.DEEPSEEK_API_KEY = None
        with self.assertRaises(self.filter.LLMConfigurationError):
            self.filter.call_llm_api("prompt")
        self.requests.post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
