"""Create synthetic installation contents in a NEW disposable home directory."""
import argparse
import json
from pathlib import Path

SCENARIOS = ["none", "current", "older", "interrupted", "missing-daemon", "broken-service", "broken-candidate"]
UNIT = """[Unit]
Description=Disposable simulator installation fixture

[Service]
ExecStart=%h/.local/share/oyasumivr/frame-companion
Restart=no

[Install]
WantedBy=default.target
"""


def seed(home, scenario):
    if scenario not in SCENARIOS:
        raise ValueError("unknown scenario")
    home = Path(home)
    home.mkdir(parents=True, exist_ok=False)
    (home / "UNRELATED-KEEP.txt").write_text("Synthetic user content. Preserve during maintenance.\n")
    if scenario == "none":
        return
    owned = home / ".local/share/oyasumivr"
    version = "0.1.0" if scenario == "older" else "0.2.0"
    release = owned / "releases" / version
    release.mkdir(parents=True)
    (owned / "active-version").write_text(version + "\n")
    launcher = owned / "frame-companion"
    launcher.write_text('#!/bin/sh\nset -eu\nroot="$HOME/.local/share/oyasumivr"\nexec "$root/releases/$(cat "$root/active-version")/daemon"\n')
    launcher.chmod(0o755)
    if scenario != "missing-daemon":
        daemon = release / "daemon"
        daemon.write_text("#!/bin/sh\nexit 23\n" if scenario == "broken-candidate" else "#!/bin/sh\nexec /usr/bin/sleep infinity\n")
        daemon.chmod(0o755)
    (release / "manifest.json").write_text(json.dumps({"fixture_only": True, "build_version": version, "protocol": {"major": 1, "minor": 0}}) + "\n")
    units = home / ".config/systemd/user"
    units.mkdir(parents=True)
    unit = UNIT.replace("frame-companion\n", "absent-fixture-command\n") if scenario == "broken-service" else UNIT
    (units / "oyasumivr-frame-companion.service").write_text(unit)
    if scenario == "interrupted":
        staging = owned / "staging/synthetic-attempt"
        staging.mkdir(parents=True)
        (staging / "daemon.partial").write_bytes(b"SYNTHETIC INCOMPLETE ARTIFACT\n")
        (owned / "transaction.json").write_text(json.dumps({"fixture_only": True, "phase": "uploading", "previous": version, "candidate": "0.3.0"}) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", choices=SCENARIOS)
    parser.add_argument("home", type=Path)
    args = parser.parse_args()
    seed(args.home, args.scenario)
