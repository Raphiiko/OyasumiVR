#!/bin/bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
[[ $root == "$HOME"/* && -f $root/owner.json && ! -L $root ]]
exec 9>"$root/maintenance.lock"
flock -n 9
unit=$(python3 -B -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["unit_name"])' "$root/owner.json")
[[ $unit == oyasumivr-frame-companion*.service && $unit != *[!A-Za-z0-9_.@-]* ]]
unit_path="$HOME/.config/systemd/user/$unit"
if [[ -f $unit_path ]]; then
    grep -Fqx "ExecStart=$root/current/oyasumivr-frame-companion serve --config $root/state/config.json" "$unit_path"
fi
systemctl --user stop "$unit" >/dev/null 2>&1 || true
systemctl --user disable "$unit" >/dev/null 2>&1 || true
if [[ -f $unit_path ]]; then
    rm -f -- "$unit_path"
fi
systemctl --user daemon-reload
python3 -B - "$root/owner.json" <<'PY'
import json, os, sys, tempfile
owner = json.load(open(sys.argv[1], encoding="utf-8"))
owned = owner.get("owned_ssh_key")
if owned:
    path = owned["authorized_keys_path"]
    if path != os.path.join(os.environ["HOME"], ".ssh", "authorized_keys"):
        raise SystemExit("owned key path is outside HOME/.ssh/authorized_keys")
    try:
        original = open(path, "rb").read()
    except FileNotFoundError:
        original = b""
    kept = []
    for line in original.splitlines(keepends=True):
        fields = line.decode("utf-8", "surrogateescape").split()
        if len(fields) >= 2 and fields[0] == owned["key_type"] and fields[1] == owned["key_data"]:
            continue
        kept.append(line)
    if b"".join(kept) != original:
        directory = os.path.dirname(path)
        fd, temporary = tempfile.mkstemp(prefix=".authorized_keys-", dir=directory)
        try:
            os.write(fd, b"".join(kept))
            os.fsync(fd)
        finally:
            os.close(fd)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
PY
rm -rf -- "$root"
