"""Run real SSH/systemd fixture checks in a disposable, networkless Arch container."""
import argparse
from pathlib import Path
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--build", action="store_true", help="build the local image first")
args = parser.parse_args()
image = "oyasumivr-stage1-install-lab:local"
name = "oyasumivr-stage1-lab-" + uuid.uuid4().hex[:12]


def run(*args, **kwargs):
    return subprocess.run(["docker", *args], check=True, **kwargs)


if args.build:
    run("build", "--tag", image, str(Path(__file__).resolve().parent))
run("image", "inspect", image, "--format", "{{.Id}}")
run("run", "-d", "--name", name, "--label", "oyasumivr.stage1.lab=true",
    "--network", "none", "--cgroupns", "private", "--tmpfs", "/run", "--tmpfs", "/tmp",
    "--cap-add", "SYS_ADMIN", "--security-opt", "seccomp=unconfined",
    "--entrypoint", "/bin/bash", image, "-c",
    "mount -o remount,rw /sys/fs/cgroup && exec /usr/lib/systemd/systemd")
try:
    deadline = time.monotonic() + 20
    while True:
        state = subprocess.run(["docker", "exec", name, "systemctl", "is-system-running"], capture_output=True, text=True)
        if state.returncode == 0 and state.stdout.strip() == "running":
            break
        if time.monotonic() >= deadline:
            run("exec", name, "systemctl", "--failed", "--no-pager")
            raise RuntimeError("systemd did not reach running state within 20 seconds")
        time.sleep(0.1)
    run("exec", name, "bash", "/opt/simlab/prepare-arch-guest.sh", "--disposable-guest")
    run("exec", name, "bash", "/opt/simlab/check-guest.sh")
    run("exec", name, "pacman", "-Q", "systemd", "openssh", "python")
    run("inspect", name, "--format", "network={{.HostConfig.NetworkMode}} cgroupns={{.HostConfig.CgroupnsMode}} mounts={{json .Mounts}} ports={{json .HostConfig.PortBindings}} privileged={{.HostConfig.Privileged}}")
finally:
    subprocess.run(["docker", "stop", "--timeout", "10", name], check=False)
    run("rm", "-f", name)
print("SSH/systemd container checks passed. VM and reboot acceptance remain separate.")
