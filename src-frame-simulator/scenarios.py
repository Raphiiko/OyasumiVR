"""Run local network scenarios and installation fixture checks. No headset access."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
for command in [
    ["cargo", "test", "--locked", "--offline", "--test", "scenarios", "--", "--nocapture"],
    [sys.executable, "install-lab/test_seed.py"],
    [sys.executable, "install-lab/test_docker_lab.py"],
]:
    print("Running:", " ".join(command), flush=True)
    result = subprocess.run(command, cwd=root)
    if result.returncode:
        raise SystemExit(result.returncode)
print("Local scenarios passed. SSH/systemd lifecycle is a separate guest check.")
