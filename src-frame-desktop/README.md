# Frame desktop pairing backend

This Windows Rust crate owns Frame pairing credentials, SSH
onboarding, installation, and the persistent status-only companion connection.
The core exposes it through Tauri. There is no pairing UI in this stage.

## Stage 4 command contract

| Command | Input | Result |
| --- | --- | --- |
| `frame_discover` | optional explicit address | bounded candidate list |
| `frame_select` | Device Manager HMD identity, candidate | persisted pairing UUID |
| `frame_run` | pairing UUID, action | operation UUID |
| `frame_cancel` | pairing UUID, operation UUID | cancellation requested |
| `frame_state` | none | current typed states |
| `frame_reconnect_at` | pairing UUID, candidate | verify pinned SSH identity, save address, start retry |

Actions are `pair`, `retry`, `repair`, `unpair`, and `forget_local`.
Only `pair` permits registration. `retry` uses saved credentials. `repair` is an
explicit installation request. `forget_local` performs no remote removal.

Subscribe to `frame-pairing-state` before issuing commands. Every event contains
pairing and operation UUIDs, `in_progress`, a typed step/error, and separate paired,
connected, last-known installation, and SteamVR readiness fields. A cancellation
request is not completion: wait for `in_progress=false`. Installation cleanup can
continue after cancellation. Read `frame_state` after subscribing or recovering
from a missed event. No command returns credentials or raw SSH output.

Discovery scans only `_steamos-devkit._tcp.local.` for four seconds, with at most
64 candidates. Discovery and HTTP data do not establish headset identity. Tests
inject candidates at this boundary, then execute the production network code.

## Identity and trust

Selection reads the current PC HMD properties from the existing OpenVR device
cache. The uploaded trusted companion can run `probe-identity ABSOLUTE_LIBRARY`
to read the remote HMD through the shared OpenVR wrapper. No service is needed.
The backend requires exact raw serial, model, and manufacturer agreement, currently
limited to Valve Deckard DV2. It never strips serial prefixes. Missing runtime
properties or differently formatted serials produce `identity_unverified`.
This does not establish a general retail Steam Frame identity mapping.

Russh supplies in-process SSH. The verifier rejects changes to saved SHA256 host
key fingerprints and rejects SSH certificates. First-use trust assumes a trusted
local network: plain HTTP approval does not authenticate the SSH server. The
first pin becomes durable after successful RSA authentication. Windows OpenSSH
is not a production dependency.

Each attempt saves one RSA-3072 key before registration and reuses it on retry.
Registration sends exactly `ssh-rsa BASE64 OyasumiVR@PC`. Existing-key SSH runs
first, including after an uncertain HTTP response. HTTP disables proxies and
redirects and bounds time and response size. Registration errors are typed.

Companion TLS uses the provisioned certificate as its only trust root and checks
the exact peer certificate before sending the bearer header. Hello verifies
device ID, daemon ID, protocol, and status-only capabilities. First installation
also requires the expected build. No commands are queued for reconnect.

## Persistence and maintenance

Core data lives in `app_local_data_dir/private-frame-pairings`, outside exported
application settings. UUID-named JSON metadata references separate current-user
Windows DPAPI blobs. Metadata includes selected and verified identities, both
pins, daemon ID, setup completion, pending upload ownership, contact time, and
maintenance backoff. Private keys, tokens, and TLS private material stay in Rust.
Non-Windows secret storage fails closed. Writes synchronize a same-directory
temporary file before atomic replacement.

One operation and one WSS watcher may own a pairing. Startup reconnects completed
pairings only. It does not discover or register. Reconnect delays increase from
one to 60 seconds. Older compatible builds trigger desktop-owned maintenance;
failed maintenance backs off for one hour. Newer compatible releases are not
downgraded. Offline status never proves removal. Confirmed missing or broken
installations require explicit repair.

The backend streams embedded `lifecycle.sh` to `bash -s` over verified SSH. It
does not install that script. Each upload uses an exclusive, mode-700 session
directory with an ownership marker. Its UUID is durable before creation. Cleanup
removes only known files and refuses unexpected contents. `inspect` precedes
maintenance; ownership is checked again under the remote maintenance lock.
Existing configuration and credentials survive updates and recovery.

Online unpair verifies remote removal and removes only the exact owned RSA key.
It saves a cleanup receipt before deleting local secrets. Failed remote cleanup
retains credentials. If the process dies after remote key removal but before the
receipt is durable, local state remains and explicit local forget is available;
the backend cannot prove an unrecorded remote result.

## Prepare the local bundle

Run from this checkout with Python 3 and Linux Rust, or Windows with WSL Ubuntu.
Install the Rust target in that toolchain beforehand. ARM64 cross-compilation
can use a Linux Zig executable supplied explicitly; no tool or artifact is fetched
by this script. The output directory must not exist.

```powershell
python src-frame-desktop/prepare-bundle.py src-core/resources/frame-companion --target aarch64-unknown-linux-gnu --zig C:/path/to/linux-zig/zig
```

The script builds this checkout with `--locked`, verifies ELF architecture, and
writes the binary plus trusted build/protocol/SHA256 metadata. The standalone
uninstaller is embedded and its digest must match the bundle. Tauri's existing
resource glob packages this directory. It is ignored by Git. Missing, mismatched,
or inconsistent artifacts fail before remote installation.

## Verification

```powershell
cargo +1.97.1 test --locked --manifest-path src-frame-desktop/Cargo.toml
cargo +1.97.1 clippy --locked --manifest-path src-frame-desktop/Cargo.toml --all-targets -- -D warnings
```

Unit tests cover protected storage, identity matching and controller state.
Hardware identity, approval, startup and wake behavior require separate headset verification.
