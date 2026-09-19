# Steam Frame companion

`oyasumivr-frame-companion` is the ARM64 Linux service installed on a paired headset. It reads a
provisioned configuration file, connects to the installed OpenVR runtime when available, and serves
the authenticated WSS status and brightness protocol. It has no updater, SSH client, telemetry, or crash
reporter. Brightness reads and writes use the same resident OpenVR connection.

```text
oyasumivr-frame-companion serve --config /absolute/path/to/state/config.json
```

The selected release directory must contain `release.json` beside the executable. The maintenance
transaction verifies the executable digest before writing this metadata. Build version and protocol
version remain separate.

The configuration contains the bearer credential and paths to the TLS certificate and private key.
Maintenance creates fresh values for the first installation and preserves them across updates. Keep
the configuration and private key mode 0600. The server certificate is pinned by the desktop after
SSH provisioning. `openvr_library_path` can select the headset's installed OpenVR library.

The process stays reachable while OpenVR is unavailable. It reports `steamvr: unavailable` until a
real wrapper initialization succeeds, retains that session, watches for runtime quit or read errors,
and retries after shutdown. Process-name detection is not used.

## Desktop-owned maintenance

`lifecycle.sh` is source for a desktop-owned SSH operation. Pipe it to `bash -s` on the headset and
pass one of `inspect`, `apply`, `recover`, or `uninstall`. Do not install or upload this script. The
future desktop core can embed the text and write it to the SSH channel's standard input.

```text
ssh HOST bash -s -- inspect ROOT UNIT < lifecycle.sh
ssh HOST bash -s -- recover ROOT UNIT < lifecycle.sh
ssh HOST bash -s -- uninstall ROOT UNIT < lifecycle.sh
ssh HOST bash -s -- apply ROOT UNIT ARTIFACT TRUSTED_SHA256 VERSION ARCH PAIRING_ID DEVICE_ID PROVISION_DIR UNINSTALLER TRUSTED_UNINSTALLER_SHA256 PORT REQUIRED_FREE_BYTES ALLOW_DOWNGRADE PROTOCOL_MINOR < lifecycle.sh
```

The artifact, provision directory, and standalone uninstaller are uploaded separately into a
caller-owned session directory. The expected digests come from the trusted desktop bundle or its
trusted metadata, never from a checksum uploaded beside the payload. Provisioning contains a fresh
bearer token, daemon ID, TLS private key, server certificate, owner record, and config. Existing
managed credentials and daemon identity are preserved by later `apply` operations.

Maintenance uses one advisory file lock, versioned releases, an atomic `current` symlink, and a
transaction record. A disconnected desktop reconnects through the independent devkit SSH service,
runs `inspect`, then streams `recover` when a transaction is present. Recovery restores the prior
release and unit state. A normal failed `apply` performs the same rollback before returning.

Only `uninstall` is copied into the installation root. This small standalone script is the explicit
advanced-user cleanup path. It does not depend on the selected companion binary. Both uninstall
paths remove only the recorded unit, installation root, enablement link, and exact owned SSH key.
An absent installation makes the streamed uninstall harmless. The installed script removes itself
with the installation root.

`inspect` emits JSON that separates installation state, service state, installed build, and running
build. SteamVR availability is checked through the authenticated companion status contract and does
not determine whether installation succeeds.

Run local protocol checks with:

```text
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo fmt --check
```

The production target is `aarch64-unknown-linux-gnu`. A successful cross-build does not prove native
runtime behavior, reboot startup, or wake recovery.

The desktop can upload the trusted binary into its temporary session and run
`probe-identity ABSOLUTE_OPENVR_LIBRARY`. It returns JSON with the intrinsic build
version and raw HMD serial, model, and manufacturer, or a null identity when the
runtime is unavailable. It creates no service or configuration. The desktop must
compare these properties with its selected PC HMD before provisioning.

For guarded desktop recovery and uninstall, the streamed script accepts
`OYASUMIVR_EXPECTED_PAIRING` and `OYASUMIVR_EXPECTED_DEVICE`. It checks these against
the owner or pending transaction under the maintenance lock. Inspection includes
transaction ownership even before first-install provisioning has finished.

## Brightness

Protocol 1.2 advertises `brightness` and `brightness_transition`. Earlier negotiated versions
remain status-only. `GetBrightness` returns readiness, reported gain bounds, applied percentage,
accepted target, operation ID, phase, linear progress, elapsed time and a monotonically increasing
revision. Set, transition and cancellation replies return the same snapshot or a typed error.
Acceptance does not confirm a hardware write. Completion requires successful readback.

The authenticated controller sends a transition ID, target and duration once. The companion applies
cubic smoothstep easing in percentage space, then gamma 2.2 below 100% and linear gain above 100%.
Writes enforce reported bounds and a 125% policy ceiling. Prototype bounds are test fixtures.
Simple-mode transitions carry their original simple start and target so the hardware floor follows
the desktop software-dimming curve over the same duration.

New work replaces the active transition. Cancellation only affects the matching operation ID.
The existing authenticated connection admits one controller. Accepted work can finish after a
connection loss. Standby retains the latest target until the display returns. Restart reads actual
hardware state without restoring a saved target. No brightness intent is persisted.
