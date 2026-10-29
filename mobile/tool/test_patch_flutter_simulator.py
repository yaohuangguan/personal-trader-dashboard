import hashlib
import unittest
from unittest.mock import patch
from patch_flutter_simulator import transformed

class SimulatorPatchTest(unittest.TestCase):
    def test_unknown_sdk_is_rejected_without_touching_source(self):
        with self.assertRaisesRegex(ValueError, 'Unexpected Flutter'):
            transformed('unreviewed SDK source')

    def test_verified_already_patched_source_is_idempotent(self):
        source='already patched verified fixture'
        with patch('patch_flutter_simulator.PATCHED_SHA',hashlib.sha256(source.encode()).hexdigest()):
            self.assertEqual(transformed(source),source)
