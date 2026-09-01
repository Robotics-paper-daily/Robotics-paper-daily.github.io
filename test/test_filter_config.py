"""Privacy boundary tests for the report pipeline's LLM endpoint."""

import importlib
import os
import sys
import types
import unittest
from unittest import mock


SRC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)


class FilterEndpointConfigTests(unittest.TestCase):
    def _reload_filter(self, env):
        with mock.patch.dict(os.environ, env, clear=True):
            sys.modules.pop("filter", None)
            # Endpoint configuration is pure import-time state. Stub requests
            # so this privacy test also runs on a clean machine before the
            # report pipeline dependencies are installed.
            with mock.patch.dict(sys.modules, {"requests": types.ModuleType("requests")}):
                return importlib.import_module("filter")

    def test_default_uses_official_deepseek_api(self):
        module = self._reload_filter({})
        self.assertEqual(module.DEEPSEEK_API_BASE, "https://api.deepseek.com")
        self.assertEqual(
            module.DEEPSEEK_API_URL,
            "https://api.deepseek.com/chat/completions",
        )

    def test_custom_base_requires_explicit_environment_configuration(self):
        module = self._reload_filter(
            {
                "DEEPSEEK_API_BASE": "https://llm.example.test/v1/",
                "DEEPSEEK_MODEL": "example-model",
            }
        )
        self.assertEqual(module.DEEPSEEK_API_URL, "https://llm.example.test/v1/chat/completions")
        self.assertEqual(module.MODEL_NAME, "example-model")

    def test_daily_workflow_allows_override_with_existing_gateway_fallback(self):
        workflow = os.path.join(REPO_ROOT, ".github", "workflows", "daily_arxiv.yml")
        with open(workflow, "r", encoding="utf-8") as f:
            text = f.read()
        self.assertIn(
            "github.repository == 'Robotics-paper-daily/Robotics-paper-daily.github.io'",
            text,
        )
        self.assertIn("'https://models.sjtu.edu.cn/api/v1' || 'https://api.deepseek.com'", text)
        self.assertIn("'deepseek-chat' || 'deepseek-v4-flash'", text)

    def test_daily_runtime_versions_are_pinned(self):
        workflow = os.path.join(REPO_ROOT, ".github", "workflows", "daily_arxiv.yml")
        with open(workflow, "r", encoding="utf-8") as f:
            text = f.read()
        self.assertIn("uses: actions/checkout@v6", text)
        self.assertIn("uses: actions/setup-python@v6", text)
        self.assertIn("python-version: '3.14'", text)

        requirements = os.path.join(REPO_ROOT, "requirements.txt")
        with open(requirements, "r", encoding="utf-8") as f:
            dependencies = set(f.read().splitlines())
        self.assertIn("arxiv==4.0.1", dependencies)
        self.assertIn("requests==2.34.2", dependencies)
        self.assertIn("Jinja2==3.1.6", dependencies)


if __name__ == "__main__":
    unittest.main()
