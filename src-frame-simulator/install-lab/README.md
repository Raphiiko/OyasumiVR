# Disposable installation fixtures

The fake HTTP/WSS simulator does not install a service. These fixtures are separate inputs for
later installer tests. Their `daemon` is a shell process that sleeps, or exits with code 23.
It does not implement the companion handshake.

```powershell
python install-lab/seed.py current .local/current-home
python install-lab/test_seed.py
```

The target home must not exist. The generator never replaces an existing directory.
Each home includes an unrelated marker that maintenance tests must preserve.

| Fixture | Contents |
| --- | --- |
| `none` | Unrelated marker only |
| `current` | Stable launcher, current release, user unit |
| `older` | Older release at the same stable launcher |
| `interrupted` | Working release plus partial staged candidate and transaction marker |
| `missing-daemon` | Existing owned directory, launcher and unit, absent daemon |
| `broken-service` | Unit points to a missing executable |
| `broken-candidate` | Selected release exits with code 23 |

`active-version` is a fixture reference, not a committed production activation design.
The transaction and manifest JSON explicitly identify themselves as fixtures. Stage 2 will
replace these schemas with its actual transaction and artifact contract.

## Docker environment

Run with Docker Desktop's Linux engine from `src-frame-simulator`:

```powershell
python install-lab/docker-lab.py --build
```

Later runs can omit `--build` to reuse the local image. The runner creates a uniquely named
Arch container, waits for real systemd to reach `running`, configures SSH, and checks all seven
layouts. It stops and removes its container even when a check fails. The image remains local
for reuse. Remove it with `docker image rm oyasumivr-stage1-install-lab:local` when no longer needed.

The runtime has `--network none`, no host mounts, no published ports, and a private cgroup namespace.
SSH runs only on container loopback. The runner adds `SYS_ADMIN` and disables the default seccomp
filter so it can remount its private cgroup filesystem writable for systemd. It does not use
`--privileged`, the host PID namespace, or a host cgroup mount. Do not add unrelated host mounts.
No real headset or existing container is involved.

The Dockerfile pins the cached Arch base image by digest. Public packages are installed during
image build; runtime checks require no network. The package keyring is initialized before upgrades,
and interactive first-boot configuration is disabled inside this container image. Rebuilding uses
current Arch packages, so record the resulting image ID for exact replay of a tested environment.
The retained image contains the tested package versions; it contains no runtime SSH keys.

The runner checks:

- Public-key SSH login with strict host-key checking and a real PAM/user-manager session.
- Absent installation reports no loaded unit.
- Current, older, and interrupted layouts start, restart, and stop through real `systemctl --user`.
- Missing daemon, broken service, and broken candidate reach failed service state.
- Stopped units have no main PID. Unrelated home content remains byte-for-byte unchanged.
- The disposable container is removed afterward. No host SSH port is exposed.

## Arch guest recipe

Use a fresh Arch Linux VM with systemd and a snapshot or disposable disk. Keep its network private;
do not bridge it onto a LAN. Copy only this `install-lab` directory into it. Do not copy research,
real home contents, or the desktop checkout. Initial package installation requires access to Arch
package mirrors. The recipe installs public `openssh` and `python` packages inside the guest only if they are absent.
Record the VM image checksum and package versions when this environment is first built.

As root inside that guest:

```sh
bash prepare-arch-guest.sh --disposable-guest
bash check-guest.sh
```

Setup requires Arch and a real systemd PID 1. It refuses an existing `simlab` account.
It creates a dedicated user, disposable client and host keys, a private known-hosts file,
and a separate SSH unit. SSH listens only on guest `127.0.0.1:32222`, accepts only that user,
and disables password login and forwarding. It does not change the standard SSH service.
The empty local account password enables the disposable account; network password login stays disabled.

The check runs inside the guest and uses real OpenSSH with strict host-key checking. It exercises
each fake layout with real `systemctl --user`: successful start/restart/stop, absent installation,
and failed start. It retains per-scenario contents under the lab user's home for inspection.
It verifies the unrelated marker remains. No fake `systemctl` command exists.

Stop the dedicated SSH listener with
`systemctl stop oyasumivr-simlab-sshd.service` inside the guest. Destroy the disposable VM disk
or restore its clean snapshot after inspection. The recipe is not a production installer or uninstaller.

For later desktop-driven installer tests, add a hypervisor NAT port forward bound only to the PC's
loopback and configure the dedicated guest SSH listener for that isolated interface. This is not
configured here. Do not expose the guest SSH service on a public or LAN interface.

A container is not a VM. The Docker checks above prove its systemd and user-manager behavior,
but do not satisfy VM boot behavior.
