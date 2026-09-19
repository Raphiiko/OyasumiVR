import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("seed", Path(__file__).with_name("seed.py"))
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


class FixtureChecks(unittest.TestCase):
    def test_all_layouts_and_no_overwrite(self):
        with tempfile.TemporaryDirectory(prefix="disposable-install-fixtures-") as directory:
            for scenario in seed.SCENARIOS:
                home = Path(directory) / scenario
                seed.seed(home, scenario)
                unrelated = home / "UNRELATED-KEEP.txt"
                self.assertTrue(unrelated.is_file())
                with self.assertRaises(FileExistsError):
                    seed.seed(home, scenario)
                owned = home / ".local/share/oyasumivr"
                if scenario == "none":
                    self.assertFalse(owned.exists())
                    continue
                version = (owned / "active-version").read_text().strip()
                self.assertEqual(version, "0.1.0" if scenario == "older" else "0.2.0")
                daemon = owned / "releases" / version / "daemon"
                self.assertEqual(daemon.exists(), scenario != "missing-daemon")
                unit = (home / ".config/systemd/user/oyasumivr-frame-companion.service").read_text()
                self.assertEqual("absent-fixture-command" in unit, scenario == "broken-service")
                if scenario == "broken-candidate":
                    self.assertIn("exit 23", daemon.read_text())
                self.assertEqual((owned / "transaction.json").exists(), scenario == "interrupted")
                self.assertEqual((owned / "staging/synthetic-attempt/daemon.partial").exists(), scenario == "interrupted")


if __name__ == "__main__":
    unittest.main()
