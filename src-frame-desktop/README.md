# Frame desktop pairing backend

This Windows Rust crate owns Frame pairing credentials, SSH
onboarding, installation, and the persistent authenticated companion connection.
The core exposes it through Tauri to the Angular pairing flow.

## Stage 4 command contract

| Command | Input | Result |
| --- | --- | --- |
| `frame_discover` | optional explicit address | bounded candidate list |
| `frame_select` | Device Manager HMD identity, candidate | persisted pairing UUID |
| `frame_run` | pairing UUID, action | operation UUID |
| `frame_cancel` | pairing UUID, operation UUID | cancellation requested |
| `frame_state` | none | current typed states |
| `frame_reconnect_at` | pairing UUID, candidate | verify pinned SSH identity, save address, start retry |

Actions are `pair`, `retry`, `repair`, `unpair`, `forget_local`, and `cleanup`.
Only `pair` permits registration. `retry` uses saved credentials. `repair` is an
explicit installation request. `forget_local` performs no remote removal.
`cleanup` removes a pending owned upload and recovers an owned transaction without reinstalling.
Explicit retry bypasses the automatic maintenance delay; background maintenance retains its backoff.

Subscribe to `frame-pairing-state` before issuing commands. Every event contains
pairing and operation UUIDs, `in_progress`, a typed step/error, and separate paired,
connected, last-known installation, and SteamVR readiness fields. A cancellation
request is not completion: wait for `in_progress=false`. Installation cleanup can
continue after cancellation. Read `frame_state` after subscribing or recovering
from a missed event. No command returns credentials or raw SSH output.

Each pairing has a monotonically increasing `revision` for this controller lifetime. Merge events
and snapshots only when their revision is newer. `action` describes an active operation;
`cancelling` preserves its cancellation outcome until another operation starts. Cancelling the
latest completed operation is idempotent; a different operation UUID is rejected.

Safe diagnostics include `address`, authenticated `installed_version`, `paired_at`, `last_contact`,
`access_verified`, `setup_stage` (verification, installation, connection), `repair_needed`, and
`cleanup_pending`. Offline version and installation data are last known. Saved companion credentials
alone do not prove installation. `paired` is true only after authenticated completion, independently
of SteamVR readiness. `remote_removal_performed` requires a persisted remote cleanup receipt.
If local deletion then fails, the record remains recoverable and another cleanup can finish it.

`authentication_failed` describes headset SSH access. `companion_authentication_failed` describes
the authenticated helper rejecting the saved client credential. The latter permits an explicit
repair with existing SSH approval, not another headset approval prompt. TLS transport loss is
`offline`; certificate validation failures remain `certificate_changed` and never bypass trust.

Selection may change an address before any trust is saved. Once a pin or companion exists, address
changes require `frame_reconnect_at` and the existing SSH pin. A candidate cannot replace trust.

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
device ID, daemon ID, protocol, and negotiated capabilities. First installation
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
Explicit repair also restores a rejected helper token from the existing local credential over
verified SSH. It checks pairing and device ownership under the maintenance lock and atomically
replaces only that configuration field. SSH pins, certificates, daemon identity, and stored
credentials remain unchanged. Repair completes only after authenticated helper verification.

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

## Brightness

`frame_brightness` accepts set, transition and cancellation intent after Rust verifies the active
PC HMD still matches the paired identity. The existing authenticated connection owns delivery.
Protocol 1.2 snapshots include brightness readiness independently of pairing, installation,
connection and SteamVR readiness. Older peers remain connected without a brightness driver.

Each connection reads actual brightness before admitting new work. One pending request replaces
older unsent intent. Disconnect discards that pending request. Accepted transitions remain owned
by the companion and are reconciled on reconnect without replay. `brightness_session` distinguishes
new connections; the enclosing pairing revision orders events and snapshots. Angular presents
requested intent separately from accepted, applied and completed state.
