# Runs on the headset through `bash -c`, as `helper.sh <command> [arguments]`.
# Exit codes: 64 usage or bad input, 65 digest mismatch, 69 helper missing, 70 no certificate,
# 73 the helper changed since the PC inspected it, 75 another PC held a lock past its wait.
set -euo pipefail

root="$HOME/.local/share/oyasumivr_helper"
binary=oyasumivr-frame-helper
unit=oyasumivr-frame-helper.service
units="$HOME/.config/systemd/user"
public_key='^(ssh|ecdsa|sk)-[a-z0-9@.-]+ [A-Za-z0-9+/]+=*( .*)?$'

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

# keys_lock: takes the lock every authorized_keys writer holds, including uninstall, for 10 s at most
keys_lock() {
  local file="$HOME/.ssh/.oyasumivr-keys.lock" deadline=$((SECONDS + 10))
  while :; do
    exec 8>"$file"
    flock -w "$((deadline > SECONDS ? deadline - SECONDS : 1))" 8 || exit 75
    # uninstall deletes the lock file, so a lock won on the old file protects nothing
    [ "$(stat -Lc %i /proc/self/fd/8)" = "$(stat -c %i "$file" 2>/dev/null)" ] && break
    exec 8>&-
  done
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

# install VERSION SHA256 PORT SEEN FRESH KEEP, with the helper executable on stdin; SEEN is the
# SHA-256 of the inspect output the PC decided on, FRESH 1 allows creating a missing helper folder,
# KEEP 1 keeps a working previous release because current does not start
install() {
  local version=$1 digest=$2 port=$3 seen=$4 fresh=${5:-0} keep=${6:-0}
  [ "$fresh" != 1 ] || mkdir -p "$root"
  lock
  [ "$(printf %s "$(inspect)" | sha256sum | cut -c1-64)" = "$seen" ] || exit 73

  # a first installation that fails removes everything it created
  if [ ! -d "$root/releases" ]; then
    trap '[ $? = 0 ] || remove_helper' EXIT
  fi

  # upload and check the executable
  mkdir -p "$root/staging" "$root/releases" "$root/clients" "$units/default.target.wants"
  cat >"$root/staging/$binary"
  printf '%s  %s\n' "$digest" "$root/staging/$binary" | sha256sum -c --status - || exit 65
  chmod 755 "$root/staging/$binary"

  # put the release in place, keeping a rollback target
  local old previous
  old=$(readlink "$root/current" 2>/dev/null || true)
  previous=$(readlink "$root/previous" 2>/dev/null || true)
  if [ "$old" = "releases/$version" ] && [ -d "$root/releases/$version" ]; then
    # same-version repair; without another rollback target, keep a copy of the replaced one
    if [ -z "$previous" ] || [ "$previous" = "$old" ] || [ ! -x "$root/$previous/$binary" ]; then
      rm -rf "$root/releases/$version.replaced.new"
      cp -a "$root/releases/$version" "$root/releases/$version.replaced.new"
      rm -rf "$root/releases/$version.replaced"
      mv "$root/releases/$version.replaced.new" "$root/releases/$version.replaced"
      ln -sfn "releases/$version.replaced" "$root/previous.new"
      mv -T "$root/previous.new" "$root/previous"
    fi
    mv "$root/staging/$binary" "$root/releases/$version/$binary"
  else
    # replace the executable by one rename, because previous can point at this release
    mkdir -p "$root/releases/$version"
    mv "$root/staging/$binary" "$root/releases/$version/$binary"
    # a repair keeps a working previous release rather than the current one that does not start
    local target=$old
    if [ "$keep" = 1 ] && [ -n "$previous" ] && [ "$previous" != "$old" ] &&
      [ "$previous" != "releases/$version" ] && [ -x "$root/$previous/$binary" ]; then
      target=$previous
    fi
    if [ -n "$target" ] && [ -x "$root/$target/$binary" ]; then
      ln -sfn "$target" "$root/previous.new"
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
}

# uninstaller VERSION, with the uninstall script on stdin; writes it only while current is that release
uninstaller() {
  local version=$1 temp
  temp=$(mktemp "$root/uninstall.XXXXXX")
  cat >"$temp"
  lock
  if [ "$(readlink "$root/current" 2>/dev/null)" != "releases/$version" ]; then
    rm -f "$temp"
    return 0
  fi
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
  [[ -n $token && $key =~ $public_key ]] || exit 64
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
  rmdir "$units/default.target.wants" "$units" 2>/dev/null || true
  rm -rf "$root"
}

# clients PC_ID: prints how many other PCs hold a token
clients() {
  local pc=$1 count=0 file
  for file in "$root"/clients/*; do
    [ -f "$file" ] || continue
    case "${file##*/}" in
      *.* | "$pc") ;;
      *) count=$((count + 1)) ;;
    esac
  done
  echo "$count"
}

# cleanup PC_ID MODE, with this PC's public key on stdin. Both modes remove this PC's token and
# key lines; unused also removes the helper when no PC holds a token, uninstall always does.
cleanup() {
  local pc=$1 mode=$2 key type data
  [[ $mode =~ ^(unused|uninstall)$ ]] || exit 64
  key=$(cat)
  type=$(cut -d' ' -f1 <<<"$key")
  data=$(cut -d' ' -f2 <<<"$key")
  # a busy helper changes nothing, so a retry can still log in
  local locked=0
  if [ -d "$root" ]; then
    lock
    locked=1
  fi
  local keys="$HOME/.ssh/authorized_keys"
  keys_lock

  # remove the token, and the helper when the mode asks for it, only in a folder held under the lock
  if [ "$locked" = 1 ] && [ -d "$root" ]; then
    rm -f "$root/clients/$pc" "$root/clients/$pc.pub"
    if [ "$mode" = uninstall ] || { [ "$mode" = unused ] && [ "$(clients "$pc")" = 0 ]; }; then
      remove_helper
    fi
  fi

  # remove the key lines last, so a failed step above leaves this PC able to try again
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

  # without a helper the lock file is the last trace on the headset
  [ -d "$root" ] || rm -f "$HOME/.ssh/.oyasumivr-keys.lock"
}

case "${1:-}" in
  identity | inspect | present | current | install | uninstaller | provision | clients | start | rollback | prune | cleanup) "$@" ;;
  *) exit 64 ;;
esac
