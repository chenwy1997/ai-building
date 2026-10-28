"""Regression for a real upstream-token exposure in an unrestricted source read."""
import importlib.util
from pathlib import Path
import unittest

file = Path(__file__).resolve().parents[1] / 'scripts' / 'read-own-source.py'
spec = importlib.util.spec_from_file_location('safe_source', file)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SourceSafety(unittest.TestCase):
    def test_source_request_never_selects_upstream(self):
        self.assertNotIn('upstream', module.FIELDS)
        self.assertNotIn('*', module.FIELDS)

    def test_nested_provider_configuration_is_not_retained(self):
        raw = {'title': '样本商品', 'properties': {'尺寸': '20cm', 'token': 'synthetic-test-only'}, 'upstream': {'token': 'synthetic-test-only'}}
        clean = module.sanitize(raw)
        self.assertEqual(clean, {'title': '样本商品', 'properties': {'尺寸': '20cm'}})

if __name__ == '__main__':
    unittest.main()
