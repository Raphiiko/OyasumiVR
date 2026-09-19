#!/bin/bash
set -euo pipefail

fail() {
    printf '%s\n' "$1" >&2
    exit 1
}

valid_root() {
    [[ $1 != *[[:space:]]* ]] && python3 -B - "$1" <<'PY'
import os, sys
path = sys.argv[1]
home = os.path.realpath(os.environ["HOME"])
resolved = os.path.realpath(path)
raise SystemExit(0 if os.path.isabs(path) and path == resolved and resolved != home and os.path.commonpath((home, resolved)) == home else 1)
PY
}

valid_unit() {
    [[ $1 == oyasumivr-frame-companion*.service && $1 != *[!A-Za-z0-9_.@-]* ]]
}

json_field() {
    python3 -B -c 'import json,sys; value=json.load(open(sys.argv[1], encoding="utf-8")); print(value[sys.argv[2]])' "$1" "$2"
}

validate_provisioning() {
    python3 -B - "$provision" "$root" "$unit" "$pairing" "$device" "$port" <<'PY'
import ipaddress, json, os, sys, uuid
directory, root, unit, pairing, device, port = sys.argv[1:]
owner = json.load(open(os.path.join(directory, "owner.json"), encoding="utf-8"))
config = json.load(open(os.path.join(directory, "config.json"), encoding="utf-8"))
if owner.get("schema") != 1 or owner.get("pairing_id") != pairing or owner.get("device_id") != device or owner.get("unit_name") != unit:
    raise SystemExit("provisioning owner does not match the verified identity")
owned = owner.get("owned_ssh_key")
if owned is not None:
    expected = os.path.join(os.environ["HOME"], ".ssh", "authorized_keys")
    if owned.get("authorized_keys_path") != expected or not owned.get("key_type") or not owned.get("key_data"):
        raise SystemExit("invalid owned SSH key record")
ipaddress.ip_address(config["bind_address"])
uuid.UUID(config["daemon_id"])
if config.get("device_id") != device or config.get("port") != int(port) or len(config.get("client_token", "")) < 32:
    raise SystemExit("provisioning config does not match the verified identity")
if config.get("certificate_path") != root + "/state/server.pem" or config.get("private_key_path") != root + "/state/server-key.pem":
    raise SystemExit("provisioning secret paths do not match the installation")
library = config.get("openvr_library_path")
if library is not None and not os.path.isabs(library):
    raise SystemExit("OpenVR library path must be absolute")
PY
}

verify_companion() {
    python3 -B - "$root/state/config.json" "$1" <<'PY'
import base64, hashlib, json, os, socket, ssl, struct, sys
config = json.load(open(sys.argv[1], encoding="utf-8"))
expected_build = sys.argv[2]
context = ssl.create_default_context(cadata=open(config["certificate_path"], encoding="utf-8").read())
raw = socket.create_connection(("127.0.0.1", config["port"]), timeout=3)
connection = context.wrap_socket(raw, server_hostname="oyasumivr-frame-companion")
key = base64.b64encode(os.urandom(16)).decode()
request = (
    f"GET /companion HTTP/1.1\r\nHost: oyasumivr-frame-companion:{config['port']}\r\n"
    "Upgrade: websocket\r\nConnection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
    f"Authorization: Bearer {config['client_token']}\r\n\r\n"
)
connection.sendall(request.encode())
response = b""
while b"\r\n\r\n" not in response and len(response) <= 8192:
    response += connection.recv(1024)
head = response.split(b"\r\n\r\n", 1)[0].decode("ascii")
if not head.startswith("HTTP/1.1 101 "):
    raise SystemExit("websocket upgrade failed")
accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
if f"sec-websocket-accept: {accept}".lower() not in head.lower():
    raise SystemExit("websocket accept mismatch")
hello = json.dumps({"id": 1, "type": "hello", "protocol": {"major": 1, "minor": 1}, "expected_device_id": config["device_id"], "expected_daemon_id": config["daemon_id"]}, separators=(",", ":")).encode()
mask = os.urandom(4)
masked = bytes(value ^ mask[index % 4] for index, value in enumerate(hello))
length = bytes([0x80 | len(hello)]) if len(hello) < 126 else b"\xfe" + struct.pack("!H", len(hello))
connection.sendall(b"\x81" + length + mask + masked)
def take(count):
    value = b""
    while len(value) < count:
        chunk = connection.recv(count - len(value))
        if not chunk:
            raise SystemExit("websocket closed")
        value += chunk
    return value
header = take(2)
size = header[1] & 0x7f
if size == 126:
    size = struct.unpack("!H", take(2))[0]
elif size == 127:
    size = struct.unpack("!Q", take(8))[0]
if header[0] & 0x0f != 1 or size > 8192:
    raise SystemExit("invalid websocket response")
reply = json.loads(take(size))
if reply.get("id") != 1 or reply.get("type") != "hello" or reply.get("build_version") != expected_build or reply.get("device_id") != config["device_id"] or reply.get("daemon_id") != config["daemon_id"] or reply.get("protocol", {}).get("major") != 1:
    raise SystemExit("companion hello mismatch")
connection.close()
PY
}

write_transaction() {
    local phase=$1 temporary="$root/.transaction-$transaction_id"
    printf '{"schema":1,"id":"%s","phase":"%s","candidate_version":"%s","candidate_created":%s,"candidate_replaced":%s,"previous_version":"%s","previous_unit_existed":%s,"previous_active":%s,"previous_enabled":%s,"fresh_installation":%s,"pairing_id":"%s","device_id":"%s"}\n' \
        "$transaction_id" "$phase" "$version" "$candidate_created" "$candidate_replaced" "$previous_version" "$previous_unit_existed" "$previous_active" "$previous_enabled" "$fresh_installation" "$pairing" "$device" > "$temporary"
    chmod 600 "$temporary"
    mv -fT "$temporary" "$root/transaction.json"
}

bool_field() {
    [[ $(json_field "$root/transaction.json" "$1") == True ]]
}

has_orphaned_state() {
    [[ -d $root/staging ]] || find "$root" -maxdepth 1 \( -name '.transaction-*' -o -name '.current-*' \) -print -quit | grep -q .
}

clean_orphaned_state() {
    [[ ! -f $root/transaction.json ]] || return 0
    rm -rf -- "$root/staging"
    find "$root" -maxdepth 1 \( -name '.transaction-*' -o -name '.current-*' \) -delete
}

rollback_locked() {
    [[ -f $root/transaction.json ]] || return 0
    local candidate previous id unit_path backup restored=true
    candidate=$(json_field "$root/transaction.json" candidate_version)
    previous=$(json_field "$root/transaction.json" previous_version)
    id=$(json_field "$root/transaction.json" id)
    unit_path="$HOME/.config/systemd/user/$unit"
    systemctl --user stop "$unit" >/dev/null 2>&1 || true
    if bool_field candidate_created; then
        if bool_field candidate_replaced; then
            if [[ -d $root/staging/$id/replaced-release ]]; then
                rm -rf -- "$root/releases/$candidate" || restored=false
                mv "$root/staging/$id/replaced-release" "$root/releases/$candidate" || restored=false
            fi
        else
            rm -rf -- "$root/releases/$candidate" || restored=false
        fi
    fi
    rm -f -- "$root/current" || restored=false
    if [[ -n $previous ]]; then
        ln -s "releases/$previous" "$root/current" || restored=false
    fi
    backup="$root/staging/$id/unit.backup"
    if bool_field previous_unit_existed; then
        install -m 644 "$backup" "$unit_path" || restored=false
    else
        rm -f -- "$unit_path" || restored=false
    fi
    if [[ -f $root/staging/$id/uninstall.backup ]]; then
        install -m 755 "$root/staging/$id/uninstall.backup" "$root/uninstall" || restored=false
    else
        rm -f -- "$root/uninstall" || restored=false
    fi
    systemctl --user daemon-reload || restored=false
    if bool_field previous_enabled; then
        systemctl --user enable "$unit" >/dev/null || restored=false
    else
        systemctl --user disable "$unit" >/dev/null 2>&1 || true
    fi
    if bool_field previous_active; then
        systemctl --user reset-failed "$unit" >/dev/null 2>&1 || true
        systemctl --user start "$unit" || restored=false
        local verified=false
        if [[ -n $previous ]]; then
            for _ in {1..30}; do
                if verify_companion "$previous" >/dev/null 2>&1; then
                    verified=true
                    break
                fi
                sleep 0.1
            done
        fi
        $verified || restored=false
    fi
    $restored || return 1
    local fresh=false
    bool_field fresh_installation && fresh=true
    rm -rf -- "$root/staging/$id"
    rm -f -- "$root/transaction.json"
    clean_orphaned_state
    if $fresh; then
        rm -rf -- "$root"
    fi
}

lock_installation() {
    mkdir -p "$root"
    chmod 700 "$root"
    exec {maintenance_fd}>"$root/maintenance.lock"
    flock -n "$maintenance_fd" || fail 'maintenance already in progress'
    if [[ -n ${OYASUMIVR_EXPECTED_PAIRING:-} ]]; then
        local identity_file="$root/owner.json"
        [[ -f $identity_file ]] || identity_file="$root/transaction.json"
        [[ -f $identity_file ]] || fail 'cannot verify maintenance ownership'
        [[ $(json_field "$identity_file" pairing_id) == "$OYASUMIVR_EXPECTED_PAIRING" && $(json_field "$identity_file" device_id) == "${OYASUMIVR_EXPECTED_DEVICE:-}" ]] || fail 'maintenance belongs to another pairing or identity'
    fi
    trap cleanup EXIT
}

cleanup() {
    local status=$?
    if (( status != 0 )) && [[ -f $root/transaction.json ]]; then
        set +e
        rollback_locked || printf 'automatic rollback remains incomplete; reconnect and run recover\n' >&2
    fi
    flock -u "$maintenance_fd" 2>/dev/null || true
    exit "$status"
}

apply_release() {
    local artifact=$1 expected_digest=$2 version_arg=$3 expected_arch=$4 pairing=$5 device=$6 provision=$7 uninstaller=$8 uninstaller_digest=$9
    shift 9
    local port=$1 required_space=$2 allow_downgrade=$3 protocol_minor=${4:-1}
    [[ $protocol_minor =~ ^[0-9]+$ && $protocol_minor -le 2 ]] || fail 'invalid protocol'
    [[ $expected_digest =~ ^[0-9a-f]{64}$ && $uninstaller_digest =~ ^[0-9a-f]{64}$ ]] || fail 'invalid artifact digest'
    [[ $version_arg =~ ^[0-9A-Za-z.+-]+$ && $pairing =~ ^[0-9A-Za-z._:-]+$ && $device =~ ^[0-9A-Za-z._:-]+$ ]] || fail 'invalid metadata'
    [[ $port =~ ^[0-9]+$ && $port -ge 1024 && $port -le 65535 ]] || fail 'invalid port'
    [[ -f $artifact && ! -L $artifact && -f $uninstaller && ! -L $uninstaller ]] || fail 'missing artifact'
    [[ $(uname -m) == "$expected_arch" ]] || fail 'architecture mismatch'
    command -v systemctl >/dev/null && command -v sha256sum >/dev/null && command -v python3 >/dev/null && command -v flock >/dev/null || fail 'missing prerequisite'
    [[ $(sha256sum "$artifact" | awk '{print $1}') == "$expected_digest" ]] || fail 'artifact digest mismatch'
    [[ $(sha256sum "$uninstaller" | awk '{print $1}') == "$uninstaller_digest" ]] || fail 'uninstaller digest mismatch'

    local root_present=false owner_present=false
    [[ -d $root ]] && root_present=true
    [[ -f $root/owner.json ]] && owner_present=true
    if $root_present && ! $owner_present && [[ ! -f $root/transaction.json ]] && find "$root" -mindepth 1 ! -name maintenance.lock -print -quit | grep -q .; then
        fail 'installation root exists without an ownership record'
    fi
    lock_installation
    rollback_locked
    clean_orphaned_state
    owner_present=false
    [[ -f $root/owner.json ]] && owner_present=true
    if $owner_present; then
        [[ $(json_field "$root/owner.json" pairing_id) == "$pairing" && $(json_field "$root/owner.json" device_id) == "$device" && $(json_field "$root/owner.json" unit_name) == "$unit" ]] || fail 'installation belongs to another pairing or identity'
    fi

    previous_version=''
    if [[ -L $root/current ]]; then
        previous_version=$(basename -- "$(readlink "$root/current")")
    fi
    if [[ -n $previous_version && $allow_downgrade != true && $(printf '%s\n%s\n' "$previous_version" "$version_arg" | sort -V | tail -n1) == "$previous_version" && $previous_version != "$version_arg" ]]; then
        fail 'a newer compatible release is already installed'
    fi
    local available artifact_size
    available=$(df -Pk "$root" | awk 'NR==2 {print $4 * 1024}')
    artifact_size=$(stat -c %s "$artifact")
    (( available >= required_space && available >= artifact_size * 2 )) || fail 'insufficient space for candidate and rollback'

    version=$version_arg
    transaction_id=$(python3 -B -c 'import uuid; print(uuid.uuid4())')
    previous_unit_existed=false
    previous_active=false
    previous_enabled=false
    previous_unit_valid=false
    fresh_installation=true
    candidate_created=true
    candidate_replaced=false
    local unit_path="$HOME/.config/systemd/user/$unit" candidate="$root/releases/$version" stage="$root/staging/$transaction_id"
    $owner_present && fresh_installation=false
    [[ -f $unit_path ]] && previous_unit_existed=true
    if $previous_unit_existed && grep -Fqx "ExecStart=$root/current/oyasumivr-frame-companion serve --config $root/state/config.json" "$unit_path"; then
        previous_unit_valid=true
    fi
    systemctl --user is-active --quiet "$unit" && previous_active=true
    systemctl --user is-enabled --quiet "$unit" && previous_enabled=true
    if [[ -f $candidate/release.json && -f $candidate/oyasumivr-frame-companion && $(json_field "$candidate/release.json" daemon_sha256) == "$expected_digest" && $(sha256sum "$candidate/oyasumivr-frame-companion" | awk '{print $1}') == "$expected_digest" ]]; then
        candidate_created=false
    elif [[ -e $candidate ]]; then
        candidate_replaced=true
    fi

    mkdir -p "$stage/release" "$root/releases" "$HOME/.config/systemd/user"
    $previous_unit_existed && cp "$unit_path" "$stage/unit.backup"
    [[ -f $root/uninstall ]] && cp "$root/uninstall" "$stage/uninstall.backup"
    write_transaction staging
    install -m 755 "$artifact" "$stage/release/oyasumivr-frame-companion"
    printf '{"schema":1,"build_version":"%s","protocol_major":1,"protocol_minor":%s,"daemon_sha256":"%s"}\n' "$version" "$protocol_minor" "$expected_digest" > "$stage/release/release.json"
    [[ $(sha256sum "$stage/release/oyasumivr-frame-companion" | awk '{print $1}') == "$expected_digest" ]] || fail 'staged artifact digest mismatch'
    if ! $owner_present; then
        [[ -f $provision/owner.json && ! -L $provision/owner.json && -f $provision/config.json && ! -L $provision/config.json && -f $provision/server.pem && ! -L $provision/server.pem && -f $provision/server-key.pem && ! -L $provision/server-key.pem ]] || fail 'incomplete provisioning files'
        validate_provisioning
        mkdir -p "$root/state"
        install -m 600 "$provision/owner.json" "$root/owner.json"
        install -m 600 "$provision/config.json" "$root/state/config.json"
        install -m 644 "$provision/server.pem" "$root/state/server.pem"
        install -m 600 "$provision/server-key.pem" "$root/state/server-key.pem"
    fi
    install -m 755 "$uninstaller" "$root/uninstall"

    write_transaction activating
    if $candidate_replaced; then
        mv "$candidate" "$stage/replaced-release"
    fi
    if $candidate_created; then
        mv "$stage/release" "$candidate"
    else
        rm -rf -- "$stage/release"
    fi
    ln -s "releases/$version" "$root/.current-$transaction_id"
    mv -fT "$root/.current-$transaction_id" "$root/current"

    write_transaction installing_unit
    local temporary_unit="$unit_path.$transaction_id"
    printf '[Unit]\nDescription=OyasumiVR Frame companion\n\n[Service]\nExecStart=%s/current/oyasumivr-frame-companion serve --config %s/state/config.json\nRestart=on-failure\nRestartSec=3\nTimeoutStopSec=5\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=default.target\n' "$root" "$root" > "$temporary_unit"
    chmod 644 "$temporary_unit"
    mv -fT "$temporary_unit" "$unit_path"
    systemctl --user daemon-reload
    systemctl --user enable "$unit" >/dev/null

    write_transaction starting
    systemctl --user reset-failed "$unit" >/dev/null 2>&1 || true
    systemctl --user restart "$unit"
    local active=false
    for _ in {1..50}; do
        if systemctl --user is-active --quiet "$unit"; then active=true; break; fi
        sleep 0.1
    done
    $active || return 1
    write_transaction verifying
    local verified=false
    for _ in {1..30}; do
        if verify_companion "$version" >/dev/null 2>&1; then
            verified=true
            break
        fi
        sleep 0.1
    done
    if ! $verified; then
        printf 'candidate failed authenticated companion verification\n' >&2
        return 1
    fi
}

commit_release() {
    local current
    current=$(basename -- "$(readlink "$root/current")")
    rm -f -- "$root/transaction.json"
    rm -rf -- "$root/staging"
    find "$root/releases" -mindepth 1 -maxdepth 1 -type d ! -name "$current" ! -name "$previous_version" -exec rm -rf -- {} +
    printf '{"action":"%s","installed_version":"%s","protocol":{"major":1,"minor":%s}}\n' "$action" "$current" "$(json_field "$root/current/release.json" protocol_minor)"
}

inspect_installation() {
    local installation=absent service=missing installed=null running=null pairing=null device=null daemon=null phase=null
    if [[ -d $root ]] && find "$root" -mindepth 1 ! -name maintenance.lock -print -quit | grep -q .; then
        installation=unowned
        if [[ -f $root/transaction.json ]]; then
            installation=interrupted_transaction
            phase="\"$(json_field "$root/transaction.json" phase)\""
        elif has_orphaned_state; then
            installation=interrupted_transaction
            phase='"orphaned_staging"'
        elif [[ -f $root/owner.json ]]; then
            installation=missing_or_broken_binary
            if [[ -L $root/current && -x $root/current/oyasumivr-frame-companion && -f $root/current/release.json ]]; then
                installation=managed
                installed="\"$(json_field "$root/current/release.json" build_version)\""
            fi
        fi
        if [[ -f $root/owner.json ]]; then
            pairing="\"$(json_field "$root/owner.json" pairing_id)\""
            device="\"$(json_field "$root/owner.json" device_id)\""
        elif [[ -f $root/transaction.json ]]; then
            pairing="\"$(json_field "$root/transaction.json" pairing_id)\""
            device="\"$(json_field "$root/transaction.json" device_id)\""
        fi
        if [[ -f $root/state/config.json ]]; then
            daemon="\"$(json_field "$root/state/config.json" daemon_id)\""
        fi
    fi
    local load active unit_path="$HOME/.config/systemd/user/$unit"
    load=$(systemctl --user show --property LoadState --value "$unit" 2>/dev/null || true)
    active=$(systemctl --user show --property ActiveState --value "$unit" 2>/dev/null || true)
    if [[ $load != not-found && -n $load ]]; then
        if [[ ! -f $unit_path ]] || ! grep -Fqx "ExecStart=$root/current/oyasumivr-frame-companion serve --config $root/state/config.json" "$unit_path"; then
            service=broken
        else
            case $active in active) service=running ;; failed) service=failed ;; *) service=stopped ;; esac
        fi
    elif [[ -z $load ]]; then
        service=unavailable
    fi
    if [[ $service == running && $installed != null ]] && verify_companion "${installed//\"/}" >/dev/null 2>&1; then
        running=$installed
    fi
    printf '{"installation":"%s","service":"%s","installed_version":%s,"running_version":%s,"pairing_id":%s,"device_id":%s,"daemon_id":%s,"transaction_phase":%s,"architecture":"%s"}\n' "$installation" "$service" "$installed" "$running" "$pairing" "$device" "$daemon" "$phase" "$(uname -m)"
}

uninstall_owned() {
    if [[ ! -d $root ]]; then
        printf '{"removed":false}\n'
        return 0
    fi
    [[ -f $root/owner.json ]] || fail 'refusing to uninstall an unowned directory'
    [[ $(json_field "$root/owner.json" unit_name) == "$unit" ]] || fail 'unit does not match ownership record'
    local unit_path="$HOME/.config/systemd/user/$unit"
    if [[ -f $unit_path ]]; then
        grep -Fqx "ExecStart=$root/current/oyasumivr-frame-companion serve --config $root/state/config.json" "$unit_path" || fail 'unit contents do not match the managed installation'
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
    expected = os.path.join(os.environ["HOME"], ".ssh", "authorized_keys")
    if path != expected:
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
    printf '{"removed":true}\n'
}

operation=${1:-}
root=${2:-}
unit=${3:-}
valid_root "$root" || fail 'invalid installation root'
valid_unit "$unit" || fail 'invalid unit name'

case $operation in
    apply)
        shift 3
        apply_release "$@"
        if $fresh_installation; then
            action=installed
        elif [[ $previous_version != "$version" ]]; then
            action=updated
        elif ! $candidate_created && $previous_unit_valid; then
            action=reused
        else
            action=repaired
        fi
        commit_release
        ;;
    inspect)
        inspect_installation
        ;;
    recover)
        [[ -d $root ]] || { printf '{"recovered":false}\n'; exit 0; }
        lock_installation
        if [[ -f $root/transaction.json ]]; then
            rollback_locked
            clean_orphaned_state
            printf '{"recovered":true}\n'
        elif has_orphaned_state; then
            clean_orphaned_state
            printf '{"recovered":true}\n'
        else
            printf '{"recovered":false}\n'
        fi
        ;;
    uninstall)
        [[ -d $root ]] || { printf '{"removed":false}\n'; exit 0; }
        lock_installation
        uninstall_owned
        ;;
    *)
        fail 'usage: lifecycle.sh apply|inspect|recover|uninstall ROOT UNIT ...'
        ;;
esac
