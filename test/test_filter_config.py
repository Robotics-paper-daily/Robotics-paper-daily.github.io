"""Privacy boundary tests for the report pipeline's LLM endpoint."""

import importlib
import os
import sys
import types
import unittest
from unittest import mock


SRC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
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


if __name__ == "__main__":
    unittest.main()
