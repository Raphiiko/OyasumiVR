"""Build a private Linux companion bundle locally. Run on Linux or Windows with WSL Ubuntu."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path)
parser.add_argument("--version", default="0.3.0")
parser.add_argument("--zig", type=Path, help="Linux Zig executable for ARM64 cross-compilation")
parser.add_argument("--target", choices=["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"], default="aarch64-unknown-linux-gnu")
args = parser.parse_args()
if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", args.version):
    parser.error("invalid build version")
repo = Path(__file__).resolve().parent.parent
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
try:
    target = repo / "src-frame-companion/target/bundle" / args.version
    if os.name == "nt":
        def linux(path):
            return "/mnt/" + path.drive[0].lower() + path.as_posix()[2:]
        subprocess.run(["wsl.exe", "-d", "Ubuntu", "--exec", "bash", "-l", "-s", "--",
            linux(repo), args.version, args.target, linux(target), linux(args.zig.resolve()) if args.zig else ""],
            input=b'''set -eu
export CARGO_BUILD_JOBS=2
cd "$1"
if [ -n "${5:-}" ]; then
    export OYASUMIVR_FRAME_ZIG="$5"
    chmod +x src-frame-desktop/zig-linker.sh
    export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER="$1/src-frame-desktop/zig-linker.sh"
    export CC_aarch64_unknown_linux_gnu="$1/src-frame-desktop/zig-linker.sh"
    export CRATE_CC_NO_DEFAULTS=1
fi
OYASUMIVR_FRAME_BUILD_VERSION="$2" cargo build --locked --release --manifest-path src-frame-companion/Cargo.toml --target "$3" --target-dir "$4"
''',
            check=True)
    else:
        env = os.environ.copy()
        env["OYASUMIVR_FRAME_BUILD_VERSION"] = args.version
        if args.zig:
            linker = repo / "src-frame-desktop/zig-linker.sh"
            linker.chmod(0o755)
            env.update(OYASUMIVR_FRAME_ZIG=str(args.zig.resolve()),
                CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=str(linker),
                CC_aarch64_unknown_linux_gnu=str(linker), CRATE_CC_NO_DEFAULTS="1")
        subprocess.run(["cargo", "build", "--locked", "--release", "--manifest-path", str(repo / "src-frame-companion/Cargo.toml"),
            "--target", args.target, "--target-dir", str(target)], check=True, env=env)
    binary = target / args.target / "release/oyasumivr-frame-companion"
    data = binary.read_bytes()
    machine = int.from_bytes(data[18:20], "little")
    arch = args.target.split("-")[0]
    if data[:6] != b"\x7fELF\x02\x01" or machine != {"x86_64": 62, "aarch64": 183}[arch]:
        raise RuntimeError("unexpected artifact architecture")
    shutil.copyfile(binary, output / "oyasumivr-frame-companion")
    manifest = dict(schema=1, build_version=args.version, architecture=arch, protocol_major=1, protocol_minor=2,
        artifact_sha256=hashlib.sha256(data).hexdigest(),
        uninstaller_sha256=hashlib.sha256((repo / "src-frame-companion/standalone-uninstall.sh").read_bytes()).hexdigest())
    (output / "bundle.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("Local bundle prepared.")
except Exception:
    for name in ["oyasumivr-frame-companion", "bundle.json"]:
        (output / name).unlink(missing_ok=True)
    output.rmdir()
    raise
