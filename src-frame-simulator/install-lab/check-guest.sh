#!/bin/bash
set -euo pipefail
[[ $EUID == 0 && -f /var/lib/oyasumivr-simlab/known_hosts ]] || exit 1
[[ $(cat /proc/1/comm) == systemd ]] || exit 1
lab=/var/lib/oyasumivr-simlab
ssh_args=(-p 32222 -i "$lab/client" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$lab/known_hosts")
ssh "${ssh_args[@]}" simlab@127.0.0.1 'test "$(id -un)" = simlab'
for scenario in none current older interrupted missing-daemon broken-service broken-candidate; do
    ssh "${ssh_args[@]}" simlab@127.0.0.1 bash -s -- "$scenario" <<'EOF'
set -euo pipefail
scenario=$1
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user stop oyasumivr-frame-companion.service 2>/dev/null || true
fixture=$(mktemp -d "$HOME/fixture-XXXXXXXX")
python /var/lib/oyasumivr-simlab/seed.py "$scenario" "$fixture/home"
if [[ -d $HOME/.local/share/oyasumivr || -f $HOME/.config/systemd/user/oyasumivr-frame-companion.service ]]; then
    echo 'Use a fresh guest for each scenario run; existing fixture retained.' >&2
    exit 1
fi
cp "$fixture/home/UNRELATED-KEEP.txt" "$HOME/UNRELATED-KEEP.txt"
if [[ $scenario != none ]]; then
    cp -a "$fixture/home/.local" "$fixture/home/.config" "$HOME/"
fi
systemctl --user daemon-reload
if [[ $scenario == none ]]; then
    test ! -e "$HOME/.local/share/oyasumivr"
    test "$(systemctl --user show -p LoadState --value oyasumivr-frame-companion.service)" = not-found
elif [[ $scenario == missing-daemon || $scenario == broken-service || $scenario == broken-candidate ]]; then
    systemctl --user start oyasumivr-frame-companion.service || true
    for attempt in {1..20}; do
        systemctl --user is-failed --quiet oyasumivr-frame-companion.service && break
        sleep 0.1
    done
    systemctl --user is-failed --quiet oyasumivr-frame-companion.service
else
    systemctl --user start oyasumivr-frame-companion.service
    systemctl --user is-active --quiet oyasumivr-frame-companion.service
    systemctl --user restart oyasumivr-frame-companion.service
    systemctl --user is-active --quiet oyasumivr-frame-companion.service
fi
if [[ $scenario != none ]]; then
    systemctl --user stop oyasumivr-frame-companion.service
    ! systemctl --user is-active --quiet oyasumivr-frame-companion.service
    test "$(systemctl --user show -p MainPID --value oyasumivr-frame-companion.service)" = 0
fi
cmp -s "$fixture/home/UNRELATED-KEEP.txt" "$HOME/UNRELATED-KEEP.txt"
if [[ -d $HOME/.local/share/oyasumivr ]]; then
    mv "$HOME/.local/share/oyasumivr" "$fixture/after"
    mv "$HOME/.config/systemd/user/oyasumivr-frame-companion.service" "$fixture/unit-after"
fi
systemctl --user daemon-reload
systemctl --user reset-failed
printf 'PASS %s through real SSH and systemd\n' "$scenario"
EOF
done
