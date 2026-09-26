# Runs on the headset through `bash -c`, as `helper.sh <command> [arguments]`.
# Exit codes: 64 usage or bad input, 65 digest mismatch, 69 helper missing, 70 no certificate,
# 73 the helper changed since the PC inspected it, 75 busy.
set -euo pipefail

root="$HOME/.local/share/oyasumivr_helper"
binary=oyasumivr-frame-helper
unit=oyasumivr-frame-helper.service
units="$HOME/.config/systemd/user"

# lock [SECONDS], 60 by default; must stay under the SSH inactivity timeout in ssh.rs.
# The first step under the lock removes an upload that an earlier operation left behind.
lock() {
  local deadline=$((SECONDS + ${1:-60}))
  while :; do
    [ -d "$root" ] || exit 69
    exec 9>"$root/maintenance.lock"
    flock -w "$((deadline > SECONDS ? deadline - SECONDS : 1))" 9 || exit 75
    # removing the helper deletes the lock file, so a lock won on the old file protects nothing
    [ "$(stat -Lc %i /proc/self/fd/9)" = "$(stat -c %i "$root/maintenance.lock" 2>/dev/null)" ] && break
    exec 9>&-
  done
  rm -rf "$root/staging"
}

identity() {
  cat "$HOME/.config/openvr/config/steamvr.vrsettings" 2>/dev/null || true
}

inspect() {
  "$root/current/$binary" info 2>/dev/null || echo null
}

present() {
  [ -d "$root" ] || exit 69
}

# current: prints the release current points at and its executable's SHA-256, such as
# "26.10.0 3f2a..."; the digest is empty when the executable is missing
current() {
  local release digest
  release=$(readlink "$root/current" 2>/dev/null || true)
  digest=$(sha256sum "$root/current/$binary" 2>/dev/null | cut -c1-64 || true)
  echo "${release#releases/} $digest"
}

# starts the service, or restarts it when it still runs a release other than current
run_current() {
  local pid
  pid=$(systemctl --user show -p MainPID --value "$unit" 2>/dev/null || echo 0)
  if [ "${pid:-0}" != 0 ] && [ "$(readlink -f "/proc/$pid/exe")" != "$(readlink -f "$root/current/$binary")" ]; then
    systemctl --user restart "$unit"
  else
    systemctl --user start "$unit"
  fi
}

# install VERSION SHA256 PORT SEEN FRESH, with the helper executable on stdin; SEEN is the
# SHA-256 of the inspect output the PC decided on, FRESH 1 allows creating a missing helper folder;
# prints "created" for a first install
install() {
  local version=$1 digest=$2 port=$3 seen=$4 fresh=${5:-0}
  [ "$fresh" != 1 ] || mkdir -p "$root"
  lock
  [ "$(printf %s "$(inspect)" | sha256sum | cut -c1-64)" = "$seen" ] || exit 73
  # a first installation that fails removes everything it created
  local created=0
  if [ ! -d "$root/releases" ]; then
    created=1
    trap '[ $? = 0 ] || remove_helper' EXIT
  fi

  # upload and check the executable
  mkdir -p "$root/staging" "$root/releases" "$root/clients" "$units/default.target.wants"
  cat >"$root/staging/$binary"
  printf '%s  %s\n' "$digest" "$root/staging/$binary" | sha256sum -c --status - || exit 65
  chmod 755 "$root/staging/$binary"

  # put the release in place, keeping a rollback target
  local old
  old=$(readlink "$root/current" 2>/dev/null || true)
  if [ "$old" = "releases/$version" ] && [ -d "$root/releases/$version" ]; then
    # same-version repair; without another rollback target, keep a copy of the replaced one
    local previous
    previous=$(readlink "$root/previous" 2>/dev/null || true)
    if [ -z "$previous" ] || [ "$previous" = "$old" ] || [ ! -d "$root/$previous" ]; then
      rm -rf "$root/releases/$version.replaced.new"
      cp -a "$root/releases/$version" "$root/releases/$version.replaced.new"
      rm -rf "$root/releases/$version.replaced"
      mv "$root/releases/$version.replaced.new" "$root/releases/$version.replaced"
      ln -sfn "releases/$version.replaced" "$root/previous.new"
      mv -T "$root/previous.new" "$root/previous"
    fi
    mv "$root/staging/$binary" "$root/releases/$version/$binary"
  else
    rm -rf "$root/releases/$version"
    mkdir "$root/releases/$version"
    mv "$root/staging/$binary" "$root/releases/$version/$binary"
    if [ -n "$old" ]; then
      ln -sfn "$old" "$root/previous.new"
      mv -T "$root/previous.new" "$root/previous"
    fi
  fi
  rmdir "$root/staging"

  # write the config and unit, switch current, restart
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
  [ "$created" = 0 ] || echo created
}

# uninstaller, with the uninstall script on stdin
uninstaller() {
  local temp
  temp=$(mktemp "$root/uninstall.XXXXXX")
  cat >"$temp"
  chmod 755 "$temp"
  mv "$temp" "$root/uninstall"
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
  printf '%s\n' "$key" >"$root/clients/$pc.pub.tmp"
  mv "$root/clients/$pc.pub.tmp" "$root/clients/$pc.pub"
  run_current
  for _ in $(seq 40); do
    [ -f "$root/tls/cert.pem" ] && break
    sleep 0.25
  done
  [ -f "$root/tls/cert.pem" ] || exit 70
  tr -d '\n' <"$root/config.json"
  echo
  cat "$root/tls/cert.pem"
}

# start: starts a stopped helper, without waiting long for another PC's maintenance
start() {
  [ -d "$root" ] || exit 69
  lock 5
  run_current
}

# rollback [VERSION [SHA256]]: points current back at previous and restarts the service; with
# VERSION, only while current is still that release with that executable, and exits 73 otherwise
rollback() {
  local version=${1:-} digest=${2:-}
  [ -d "$root" ] || exit 69
  lock
  [ -z "$version" ] || [ "$(readlink "$root/current" 2>/dev/null)" = "releases/$version" ] || exit 73
  [ -z "$digest" ] || printf '%s  %s\n' "$digest" "$root/current/$binary" | sha256sum -c --status - || exit 73
  local previous
  previous=$(readlink "$root/previous" 2>/dev/null) || exit 69
  [ -x "$root/$previous/$binary" ] || exit 69
  ln -sfn "$previous" "$root/current.new"
  mv -T "$root/current.new" "$root/current"
  systemctl --user restart "$unit"
}

# prune: removes every release except current and previous
prune() {
  [ -d "$root" ] || exit 69
  lock
  local current previous release
  current=$(readlink "$root/current" 2>/dev/null || true)
  previous=$(readlink "$root/previous" 2>/dev/null || true)
  for release in "$root"/releases/*; do
    [ -e "$release" ] || continue
    [ "releases/${release##*/}" = "$current" ] || [ "releases/${release##*/}" = "$previous" ] || rm -rf "$release"
  done
}

remove_helper() {
  systemctl --user disable --now "$unit" 2>/dev/null || true
  rm -f "$units/$unit" "$units/default.target.wants/$unit"
  systemctl --user daemon-reload || true
  rm -rf "$root"
}

# uninstall_helper PC_ID: removes this PC's token files, then the helper when no other PC holds a
# token; leaves authorized_keys alone
uninstall_helper() {
  local pc=$1 file
  [ -d "$root" ] || return 0
  lock
  rm -f "$root/clients/$pc" "$root/clients/$pc.pub"
  for file in "$root"/clients/*; do
    [ -f "$file" ] || continue
    case "${file##*/}" in
      *.*) ;;
      *) return 0 ;;
    esac
  done
  remove_helper
}

# cleanup PC_ID REMOVE_HELPER, with this PC's public key on stdin
cleanup() {
  local pc=$1 remove_helper=$2 key type data
  key=$(cat)
  type=$(cut -d' ' -f1 <<<"$key")
  data=$(cut -d' ' -f2 <<<"$key")
  local locked=0
  if [ -d "$root" ]; then
    exec 9>"$root/maintenance.lock"
    flock -w 45 9 && locked=1
  fi
  if [ "$locked" = 1 ]; then
    rm -f "$root/clients/$pc" "$root/clients/$pc.pub"
  fi
  local keys="$HOME/.ssh/authorized_keys"
  # every authorized_keys writer holds this lock, including uninstall
  exec 8>"$HOME/.ssh/.oyasumivr-keys.lock"
  flock -w 10 8 || exit 75
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
  [ "$locked" = 1 ] || [ ! -d "$root" ] || exit 75
  if [ "$remove_helper" = 1 ] && [ -d "$root" ]; then
    if [ -z "$(ls -A "$root/clients" 2>/dev/null)" ]; then
      remove_helper
    fi
  fi
}

case "${1:-}" in
  identity | inspect | present | current | install | uninstaller | provision | start | rollback | prune | uninstall_helper | cleanup) "$@" ;;
  *) exit 64 ;;
esac
