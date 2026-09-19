"""Check cleanup when Docker creates a container but cannot start it."""
from pathlib import Path
import runpy
import subprocess
import sys
import unittest
from unittest.mock import patch


class CleanupTest(unittest.TestCase):
    def test_failed_start_removes_only_the_created_container(self):
        for exists in (True, False):
            calls = []

            def docker(args, **kwargs):
                calls.append(args)
                if args[1] == "run":
                    raise subprocess.CalledProcessError(125, args)
                if args[1:3] == ["container", "inspect"]:
                    return subprocess.CompletedProcess(args, 0 if exists else 1)
                return subprocess.CompletedProcess(args, 0)

            with self.subTest(exists=exists), patch.object(sys, "argv", ["docker-lab.py"]), patch("subprocess.run", side_effect=docker):
                with self.assertRaises(subprocess.CalledProcessError) as failure:
                    runpy.run_path(str(Path(__file__).with_name("docker-lab.py")), run_name="__main__")
                self.assertEqual(failure.exception.returncode, 125)
                created = next(c[c.index("--name") + 1] for c in calls if c[1] == "run")
                removals = [c for c in calls if c[1] == "rm"]
                self.assertEqual(removals, [["docker", "rm", "-f", created]] if exists else [])


if __name__ == "__main__":
    unittest.main()
