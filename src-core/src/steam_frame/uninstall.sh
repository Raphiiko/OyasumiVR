#!/bin/bash
# Removes OyasumiVR Helper from this headset, with the SSH access it gave to paired PCs.
# Run as the user that paired the headset: bash ~/.local/share/oyasumivr_helper/uninstall
set -euo pipefail

root="$HOME/.local/share/oyasumivr_helper"
unit=oyasumivr-frame-helper.service
units="$HOME/.config/systemd/user"
keys="$HOME/.ssh/authorized_keys"

if [ ! -d "$root" ]; then
  echo "OyasumiVR Helper is not installed."
  exit 0
fi

exec 9>"$root/maintenance.lock"
if ! flock -w 60 9; then
  echo "Another PC is updating OyasumiVR Helper. Try again in a minute." >&2
  exit 75
fi
exec 8>"$HOME/.ssh/.oyasumivr-keys.lock"
if ! flock -w 10 8; then
  echo "Another PC is changing SSH access on this headset. Try again in a minute." >&2
  exit 75
fi

systemctl --user disable --now "$unit" 2>/dev/null || true
rm -f "$units/$unit" "$units/default.target.wants/$unit"
systemctl --user daemon-reload 2>/dev/null || true

# remove every key line that a paired PC recorded in clients/
if [ -f "$keys" ] && compgen -G "$root/clients/*.pub" >/dev/null; then
  temp=$(mktemp "$HOME/.ssh/authorized_keys.XXXXXX")
  cat "$root"/clients/*.pub | awk '
    FILENAME == "-" { if (NF >= 2) owned[$1 " " $2] = 1; next }
    { for (i = 1; i < NF; i++) if (($i " " $(i + 1)) in owned) next; print }
  ' - "$keys" >"$temp"
  chmod --reference="$keys" "$temp"
  mv "$temp" "$keys"
fi

rm -rf "$root"
echo "OyasumiVR Helper was removed."
