"""Bounded rating recovery without weakening required-field validation."""

import json
import unittest
from unittest import mock

from test.test_filter_api import FakeResponse, load_filter_module


def rating(**overrides):
    result = {
        "tldr": "English summary",
        "tldr_zh": "Translated summary",
        "topic": "VLA",
        "keywords": ["robotics"],
        "relevance_score": 9,
        "novelty_claim_score": 8,
        "clarity_score": 8,
        "potential_impact_score": 9,
        "overall_priority_score": 9,
    }
    result.update(overrides)
    return result


class RatingRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.filter, self.requests = load_filter_module()
        self.filter.DEEPSEEK_API_KEY = "private-test-key"
        sleep_patch = mock.patch.object(self.filter.time, "sleep")
        jitter_patch = mock.patch.object(self.filter.random, "uniform", return_value=0)
        self.sleep = sleep_patch.start()
        jitter_patch.start()
        self.addCleanup(sleep_patch.stop)
        self.addCleanup(jitter_patch.stop)

    def paper(self, title="Paper"):
        return {"title": title, "summary": "Abstract"}

    def test_topic_normalization_only_accepts_enum_format_variations(self):
        variants = {
            " vla ": "VLA",
            "World Model": "WorldModel",
            "Autonomous-Driving": "AutonomousDriving",
            "humanoid_embodied": "HumanoidEmbodied",
            "perception 3D": "Perception3D",
            "RL\tRobot": "RLRobot",
            "Other": "Other",
        }
        for supplied, expected in variants.items():
            with self.subTest(topic=supplied):
                self.assertEqual(self.filter._canonical_topic(supplied), expected)
                self.assertEqual(self.filter._rating_validation_errors(rating(topic=supplied)), [])
                paper = self.paper()
                with mock.patch.object(self.filter, "call_llm_api", return_value=json.dumps(rating(topic=supplied))) as call:
                    self.filter.filter_and_rate_papers([paper])
                self.assertEqual(paper["topic"], expected)
                call.assert_called_once()
        self.sleep.assert_not_called()

    def test_validator_does_not_guess_semantic_aliases_or_accept_invalid_topics(self):
        for supplied in ("Navigation", "Vision Language Action", "VLA/WorldModel", "", " \t", None, [], {}, 1):
            with self.subTest(topic=supplied):
                self.assertIsNone(self.filter._canonical_topic(supplied))
                self.assertIn("invalid:topic", self.filter._rating_validation_errors(rating(topic=supplied)))

    def test_paper_32_recovers_without_repeating_previous_31_and_finishes_46(self):
        papers = [self.paper(f"Paper-{index:02d}") for index in range(1, 47)]
        valid = json.dumps(rating())
        responses = [valid] * 31 + [json.dumps(rating(topic="Navigation")), valid] + [valid] * 14
        with mock.patch.object(self.filter, "call_llm_api", side_effect=responses) as call:
            result = self.filter.filter_and_rate_papers(papers)
        self.assertIs(result, papers)
        self.assertEqual(call.call_count, 47)
        for index, paper in enumerate(papers):
            self.assertIs(paper["ai_processed"], True)
            expected_calls = 2 if index == 31 else 1
            prompts = [args.args[0] for args in call.call_args_list]
            self.assertEqual(sum(f"Title: {paper['title']}\n" in prompt for prompt in prompts), expected_calls)
        self.assertTrue(all(args.kwargs.get("max_tokens") == 400 for args in call.call_args_list))
        correction = call.call_args_list[32].args[0]
        self.assertIn("invalid:topic", correction)
        for topic in self.filter.TOPICS:
            self.assertIn(topic, correction)
        self.assertNotIn('"topic": "Navigation"', correction)
        self.sleep.assert_called_once_with(2)

    def test_unknown_nonempty_topic_falls_back_only_after_three_attempts(self):
        paper = self.paper()
        with mock.patch.object(self.filter, "call_llm_api", return_value=json.dumps(rating(topic="Navigation"))) as call:
            with self.assertLogs(level="WARNING") as logs:
                self.filter.filter_and_rate_papers([paper])
        self.assertEqual(call.call_count, 3)
        self.assertEqual(self.sleep.call_args_list, [mock.call(2), mock.call(4)])
        self.assertEqual(paper["topic"], "Other")
        self.assertIs(paper["ai_processed"], True)
        self.assertEqual(paper["overall_priority_score"], 9)
        self.assertIn("Other", "\n".join(logs.output))

    def test_missing_empty_null_or_nonstring_topic_cannot_fall_back(self):
        candidates = [rating(topic=value) for value in (None, "", " \t", [], {}, 0)]
        missing = rating()
        del missing["topic"]
        candidates.append(missing)
        for invalid in candidates:
            with self.subTest(topic=invalid.get("topic", "missing")):
                paper = self.paper()
                with mock.patch.object(self.filter, "call_llm_api", return_value=json.dumps(invalid)) as call:
                    with self.assertRaises(self.filter.LLMUnavailableError):
                        self.filter.filter_and_rate_papers([paper])
                self.assertEqual(call.call_count, 3)
                self.assertIs(paper["ai_processed"], False)
                self.assertNotIn("topic", paper)

    def test_unknown_topic_with_other_invalid_fields_still_stops_publication(self):
        failures = [
            {"relevance_score": None},
            {"novelty_claim_score": 0},
            {"clarity_score": 11},
            {"potential_impact_score": False},
            {"overall_priority_score": "bad"},
            {"overall_priority_score": 4.5},
            {"tldr": ""},
            {"tldr_zh": None},
            {"keywords": ["robotics", None]},
        ]
        for overrides in failures:
            with self.subTest(overrides=overrides):
                paper = self.paper()
                with mock.patch.object(self.filter, "call_llm_api", return_value=json.dumps(rating(topic="Navigation", **overrides))) as call:
                    with self.assertRaises(self.filter.LLMUnavailableError):
                        self.filter.filter_and_rate_papers([paper])
                self.assertEqual(call.call_count, 3)
                self.assertIs(paper["ai_processed"], False)
                self.assertNotIn("overall_priority_score", paper)

    def test_non_json_missing_fields_and_bad_scores_can_be_corrected(self):
        responses = ("not JSON", "", "null", "[]", "{}", json.dumps(rating(clarity_score=11)))
        for invalid in responses:
            with self.subTest(response=invalid):
                paper = self.paper()
                with mock.patch.object(self.filter, "call_llm_api", side_effect=[invalid, json.dumps(rating())]) as call:
                    self.filter.filter_and_rate_papers([paper])
                self.assertEqual(call.call_count, 2)
                self.assertIs(paper["ai_processed"], True)

    def test_malformed_json_still_raises_when_correction_budget_is_exhausted(self):
        paper = self.paper()
        with mock.patch.object(self.filter, "call_llm_api", return_value="not JSON") as call:
            with self.assertRaises(self.filter.LLMUnavailableError):
                self.filter.filter_and_rate_papers([paper])
        self.assertEqual(call.call_count, 3)
        self.assertIs(paper["ai_processed"], False)

    def test_exhausted_network_retry_is_not_repeated_by_schema_recovery(self):
        paper = self.paper()
        paper["ai_processed"] = True
        with mock.patch.object(self.filter, "call_llm_api", return_value=None) as call:
            with self.assertRaises(self.filter.LLMUnavailableError):
                self.filter.filter_and_rate_papers([paper])
        call.assert_called_once()
        self.sleep.assert_not_called()
        self.assertIs(paper["ai_processed"], False)

    def test_network_failure_after_invalid_output_stops_without_further_correction(self):
        paper = self.paper()
        with mock.patch.object(self.filter, "call_llm_api", side_effect=["{}", None]) as call:
            with self.assertRaises(self.filter.LLMUnavailableError):
                self.filter.filter_and_rate_papers([paper])
        self.assertEqual(call.call_count, 2)
        self.sleep.assert_called_once_with(2)

    def test_auth_failure_propagates_without_retry_and_marks_paper_unprocessed(self):
        paper = self.paper()
        paper["ai_processed"] = True
        self.requests.post.return_value = FakeResponse(401)
        with self.assertRaises(self.filter.LLMConfigurationError):
            self.filter.filter_and_rate_papers([paper])
        self.requests.post.assert_called_once()
        self.sleep.assert_not_called()
        self.assertIs(paper["ai_processed"], False)

    def test_invalid_output_is_not_echoed_in_logs_or_correction_prompt(self):
        secret = "RAW-RESPONSE-MUST-NOT-LEAK-private-test-key"
        invalid = json.dumps(rating(topic=secret, tldr=secret))
        with mock.patch.object(self.filter, "call_llm_api", return_value=invalid) as call:
            with self.assertLogs(level="WARNING") as logs:
                self.filter.filter_and_rate_papers([self.paper()])
        self.assertNotIn(secret, "\n".join(logs.output))
        self.assertNotIn(self.filter.DEEPSEEK_API_KEY, "\n".join(logs.output))
        for invocation in call.call_args_list:
            self.assertNotIn(secret, invocation.args[0])


if __name__ == "__main__":
    unittest.main()
