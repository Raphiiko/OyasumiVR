# Runs on the headset through `bash -c`, as `helper.sh <command> [arguments]`.
# Exit codes: 64 usage or bad input, 65 digest mismatch, 69 helper missing, 70 no certificate, 75 busy.
set -euo pipefail

root="$HOME/.local/share/oyasumivr_helper"
binary=oyasumivr-frame-helper
unit=oyasumivr-frame-helper.service
units="$HOME/.config/systemd/user"

lock() {
  mkdir -p "$root"
  exec 9>"$root/maintenance.lock"
  flock -w 45 9 || exit 75
}

identity() {
  cat "$HOME/.config/openvr/config/steamvr.vrsettings" 2>/dev/null || true
}

inspect() {
  "$root/current/$binary" info 2>/dev/null || echo null
}

# install VERSION SHA256 PORT SEEN, with the helper executable on stdin;
# SEEN is the SHA-256 of the inspect output the PC decided on
install() {
  local version=$1 digest=$2 port=$3 seen=$4
  lock
  [ "$(printf %s "$(inspect)" | sha256sum | cut -c1-64)" = "$seen" ] || exit 75
  rm -rf "$root/staging"
  mkdir -p "$root/staging" "$root/releases" "$root/clients" "$units/default.target.wants"
  cat >"$root/staging/$binary"
  printf '%s  %s\n' "$digest" "$root/staging/$binary" | sha256sum -c --status - || exit 65
  chmod 755 "$root/staging/$binary"
  rm -rf "$root/releases/$version"
  mkdir "$root/releases/$version"
  mv "$root/staging/$binary" "$root/releases/$version/$binary"
  [ -f "$root/config.json" ] || printf '{"port":%d}\n' "$port" >"$root/config.json"
  cat >"$units/$unit" <<EOF
[Unit]
Description=OyasumiVR Helper

[Service]
ExecStart=%h/.local/share/oyasumivr_helper/current/$binary serve
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  ln -sfn "../$unit" "$units/default.target.wants/$unit"
  ln -sfn "releases/$version" "$root/current.new"
  mv -T "$root/current.new" "$root/current"
  systemctl --user daemon-reload
  systemctl --user restart "$unit"
}

# uninstaller, with the uninstall script on stdin
uninstaller() {
  cat >"$root/uninstall.tmp"
  chmod 755 "$root/uninstall.tmp"
  mv "$root/uninstall.tmp" "$root/uninstall"
}

# provision PC_ID, with this PC's token and then its public key on stdin;
# prints the config line, then the certificate
provision() {
  local pc=$1 token key
  [ -x "$root/current/$binary" ] || exit 69
  IFS= read -r token
  IFS= read -r key || true
  [[ -n $token && $key =~ ^(ssh|ecdsa|sk)-[a-z0-9@.-]+\ [A-Za-z0-9+/]+=*(\ .*)?$ ]] || exit 64
  lock
  mkdir -p "$root/clients"
  (umask 077 && printf '%s' "$token" >"$root/clients/$pc.tmp")
  mv "$root/clients/$pc.tmp" "$root/clients/$pc"
  printf '%s
' "$key" >"$root/clients/$pc.pub.tmp"
  mv "$root/clients/$pc.pub.tmp" "$root/clients/$pc.pub"
  systemctl --user start "$unit"
  for _ in $(seq 40); do
    [ -f "$root/tls/cert.pem" ] && break
    sleep 0.25
  done
  [ -f "$root/tls/cert.pem" ] || exit 70
  tr -d '\n' <"$root/config.json"
  echo
  cat "$root/tls/cert.pem"
}

# cleanup PC_ID REMOVE_HELPER, with this PC's public key on stdin
cleanup() {
  local pc=$1 remove_helper=$2 key type data
  key=$(cat)
  type=$(cut -d' ' -f1 <<<"$key")
  data=$(cut -d' ' -f2 <<<"$key")
  rm -f "$root/clients/$pc" "$root/clients/$pc.pub"
  local keys="$HOME/.ssh/authorized_keys"
  if [ -f "$keys" ]; then
    local temp
    temp=$(mktemp "$HOME/.ssh/authorized_keys.XXXXXX")
    awk -v type="$type" -v data="$data" '{
      for (i = 1; i < NF; i++) if ($i == type && $(i + 1) == data) next
      print
    }' "$keys" >"$temp"
    chmod --reference="$keys" "$temp"
    mv "$temp" "$keys"
  fi
  if [ "$remove_helper" = 1 ] && [ -d "$root" ]; then
    lock
    if [ -z "$(ls -A "$root/clients" 2>/dev/null)" ]; then
      systemctl --user disable --now "$unit" 2>/dev/null || true
      rm -f "$units/$unit" "$units/default.target.wants/$unit"
      systemctl --user daemon-reload || true
      rm -rf "$root"
    fi
  fi
}

case "${1:-}" in
  identity | inspect | install | uninstaller | provision | cleanup) "$@" ;;
  *) exit 64 ;;
esac
