#!/bin/bash
set -euo pipefail

if [[ ${1:-} != --disposable-guest || $EUID != 0 ]]; then
    echo 'Run as root inside a disposable Arch guest: prepare-arch-guest.sh --disposable-guest' >&2
    exit 1
fi
source /etc/os-release
[[ $ID == arch && $(cat /proc/1/comm) == systemd ]] || { echo 'Requires Arch with systemd as PID 1' >&2; exit 1; }
! id simlab &>/dev/null || { echo 'Guest already contains simlab; use a fresh guest' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
if ! pacman -Q openssh python >/dev/null 2>&1; then
    pacman -Syu --noconfirm --needed openssh python
fi
useradd --create-home --shell /bin/bash simlab
passwd -d simlab
install -d -m 700 /home/simlab/.ssh
install -d -m 755 /var/lib/oyasumivr-simlab
ssh-keygen -q -t ed25519 -N '' -C DISPOSABLE-LOCAL-LAB -f /var/lib/oyasumivr-simlab/client
ssh-keygen -q -t ed25519 -N '' -C DISPOSABLE-LOCAL-LAB-HOST -f /var/lib/oyasumivr-simlab/host
install -m 600 /var/lib/oyasumivr-simlab/client.pub /home/simlab/.ssh/authorized_keys
chown -R simlab:simlab /home/simlab/.ssh
cat > /var/lib/oyasumivr-simlab/sshd_config <<'EOF'
Port 32222
ListenAddress 127.0.0.1
HostKey /var/lib/oyasumivr-simlab/host
PidFile /run/oyasumivr-simlab-sshd.pid
AuthorizedKeysFile .ssh/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PermitRootLogin no
AllowUsers simlab
UsePAM yes
AllowTcpForwarding no
X11Forwarding no
EOF
cat > /etc/systemd/system/oyasumivr-simlab-sshd.service <<'EOF'
[Unit]
Description=Disposable local SSH installation lab
After=network.target
[Service]
ExecStart=/usr/bin/sshd -D -e -f /var/lib/oyasumivr-simlab/sshd_config
[Install]
WantedBy=multi-user.target
EOF
loginctl enable-linger simlab
systemctl daemon-reload
systemctl start oyasumivr-simlab-sshd.service
install -m 755 "$script_dir/seed.py" /var/lib/oyasumivr-simlab/seed.py
awk '{ print "[127.0.0.1]:32222 " $1 " " $2 }' /var/lib/oyasumivr-simlab/host.pub > /var/lib/oyasumivr-simlab/known_hosts
echo 'Lab SSH listens only inside the guest at 127.0.0.1:32222. Run check-guest.sh as root.'
