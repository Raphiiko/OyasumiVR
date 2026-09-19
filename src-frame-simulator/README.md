# Local companion simulator

This independent Rust executable serves a fake SteamOS devkit over HTTP and a companion
over authenticated WSS. It does not import the desktop core or OpenVR. It has no analytics,
crash reporter, hardware access, SSH client, or discovery broadcasts.

## Start, operate, stop, reset

Run these commands from `src-frame-simulator`. Rust/Cargo and Python 3 are required.
The lockfile pins dependencies. On a new development machine, `cargo fetch --locked`
downloads public dependencies; subsequent commands can run offline.

```powershell
cargo run --locked --offline
```

Default endpoints:

- Devkit: `http://localhost:32000`
- Companion: `wss://localhost:32001/companion`

In a second terminal:

```powershell
python control.py arm
python control.py register
```

Registration waits. In a third terminal, run `python control.py approve` or
`python control.py deny`. `python control.py timeout` expires the pending request
immediately. `python control.py arm 100` uses a 100 ms deadline instead of 30 seconds.
Pairing mode is consumed by one request. Reopen it explicitly for each retry.

```powershell
python control.py state
python control.py approve_and_drop
python control.py append_duplicates on
python control.py steamvr unavailable
python control.py steamvr ready
python control.py offline
python control.py online
python control.py disconnect
python control.py reset
```

`approve_and_drop` requires a pending registration. It installs the key, then aborts the
HTTP response. The client reports uncertainty. Inspect `state` before explicitly retrying.
The real pairing client must instead verify saved-key SSH access before another registration.
The simulator's registration inspection does not prove SSH authentication.

`state` reports approved registration attempts separately from installed key entries.
By default, another approval of the same key adds an attempt but not another key entry.
`append_duplicates on` exercises key accumulation explicitly, including identical keys.
Reset clears keys and pending approval, restores default scenarios, and disconnects WSS clients.
Nothing persists across process restarts. Ctrl+C stops both listeners and their client tasks.

Ports and loopback IPv4 address are optional positional arguments:

```powershell
cargo run --locked --offline -- 32002 32003
python control.py scenario wrong-device --port 32002
cargo run --locked --offline -- 32000 32001 127.0.0.2
python control.py state --address 127.0.0.2
```

Use separate terminals for two simulators. Stop the first instance before moving its address.
Non-loopback binds are rejected. The bundled TLS certificate covers `localhost`, `127.0.0.1`,
and `127.0.0.2`. Do not import it into the operating system trust store.

## Run scenarios

```powershell
python scenarios.py
cargo fmt --check
cargo clippy --locked --offline --all-targets -- -D warnings
```

The runner uses real ephemeral loopback TCP ports, HTTP bodies, TLS certificate validation,
WebSocket upgrades, and JSON messages. It starts and stops its own services.
Approval and forced timeout use the operator endpoint; tests do not sleep through a 30-second window.

Checks cover registration, refusal, denial, timeout, uncertain results, duplicate key policies,
malformed keys, concurrent registration, reset, wrong identity, client authentication, server trust,
competing controllers, older builds, incompatible protocol, missing SteamVR, disconnect/reconnect,
message bounds, two endpoints, changed address, and explicit-address fallback.

The runner also checks every fake installation layout. It does not claim SSH or systemd lifecycle
coverage itself. The separate Docker lab passes real SSH/systemd checks for all seven layouts.
See [install-lab/README.md](install-lab/README.md) for its command and the remaining VM limitation.

## Discovery and pairing contracts

`fixtures/discovery.json` supplies `one`, `two`, `non-frame`, `changed-address`, `wrong-device`,
and `discovery-unavailable`. Select one with `python control.py scenario <name>` and inspect it
with `python control.py discovery`. The fixture includes expected test identities, but candidate
records themselves contain only unverified hints. Do not expose fixture expectations as discovery proof.

These are injected records, not mDNS advertisements. Fixtures use default example ports; tests
substitute their bound endpoints. The `two` fixture describes two processes, not two identities
on one listener. Discovery unavailable supplies an explicit-address candidate and an unavailable flag.

`src/contracts.rs` separates `DiscoveryCandidate`, `PairingProgress`, `PairingError`,
`PairingRecord`, and `ConnectionState`. A durable record stores identity and credential references,
SSH and certificate pins, and last contact. Connection state and SteamVR availability are separate.
No desktop settings or credential storage implementation exists here.

All device identities are synthetic. Exact comparison exercises wrong-device rejection, but does
not establish a normalization rule between real headset and PC identity formats. Stage 2/3 must
resolve that relationship before installing on a selected device. Hostnames and devkit properties
cannot establish it.

## Devkit HTTP behavior

| Request | Response |
| --- | --- |
| `GET /properties.json` | 200, `application/json`, synthetic devkit properties |
| `GET /login-name` | 200, `text/plain`, `steamos` |
| `GET /?command=ping` | 200, `text/plain`, `pong\n` |
| `POST /register`, approved | 200, `text/plain`, `Registered\n` |
| Registration not armed | 403, `text/plain`, JSON `error` describing Pair new host |
| Denied | 403, JSON `error`, synthetic denial wording |
| Approval deadline expired | 403, JSON `error`: `timeout - Steam did not respond to the pairing request` |
| Invalid key | 403, JSON `error`: `Failed to write the ssh key` |
| Another request pending | 409, `busy`, simulator convention |
| Body exceeds 65,535 bytes | 413, simulator transport limit |

The request body must have exactly `ssh-rsa <base64> <comment>` with single spaces.
A trailing line ending is accepted. The simulator checks the encoded RSA wire structure and
accepts 2048 through 8192-bit modulus storage sizes. It rejects control characters in the comment.
This is deliberately stricter than the installed service's string scanning; it does not reproduce
malformed-input bugs. `fixtures/client.pub` is a disposable generated RSA key, not a device key.

The denial text,
one-request arming lifetime, 409 policy, and connection-drop injection remain simulator choices.
Do not build production error classification solely around the synthetic denial wording.

The operator API is simulator-only. It requires
`Authorization: Bearer DISPOSABLE-LOCAL-OPERATOR-CREDENTIAL-ONLY` for
`GET /__sim/state`, `GET /__sim/discovery`, and `POST /__sim/control`.
`control.py` sends the tagged JSON actions defined by `Control` in `src/simulator.rs`.
No CORS access is enabled. `offline` disables the companion while preserving devkit controls;
stop the process to represent complete device network loss.

## Companion wire contract

The intended transport remains WSS. Approved SSH will provision the random client credential
and pinned server certificate in later stages. First-use SSH trust is an explicit local-network
assumption after approval; changed pins require repair. Plain HTTP registration does not establish
cryptographic server identity. Stage 1 substitutes disposable local fixtures for provisioning only.

Connect to `/companion` with the HTTP header:

```text
Authorization: Bearer DISPOSABLE-LOCAL-CLIENT-CREDENTIAL-ONLY
```

Trust only `fixtures/server.der` or its PEM equivalent for this connection. The Rust test client
builds a private trust store from that certificate and validates the TLS peer normally.
`other-server.der` is an unrelated certificate used to demonstrate trust failure.
All bundled private keys are disposable fixtures, valid only for this local development service.
Certificate validity ends on 2036-01-01. No real credentials belong in this directory.

Bad credentials receive HTTP 401 before WebSocket upgrade. A second authenticated controller
receives HTTP 409 while one session is active. Server trust failures terminate TLS before a bearer
credential is sent. A successful upgrade alone does not establish companion readiness.

Send a UTF-8 text message within three seconds:

```json
{"id":1,"type":"hello","protocol":{"major":1,"minor":1},"expected_device_id":"synthetic-hmd-a","expected_daemon_id":"synthetic-daemon-a"}
```

The reply echoes the request ID:

```json
{"id":1,"type":"hello","protocol":{"major":1,"minor":1},"build_version":"0.2.0-simulator","device_id":"synthetic-hmd-a","daemon_id":"synthetic-daemon-a","capabilities":["status"],"steamvr":"ready"}
```

Protocol compatibility requires equal major versions; the negotiated minor is the lower minor.
All currently implemented commands exist in 1.0. Future additive commands require a negotiated
minor and capability check. Build version is informational and does not determine compatibility.
Unknown JSON fields are ignored. Unknown commands, malformed JSON, binary data, and messages or
frames over 8192 bytes close the connection. Clients must use distinct unsigned 64-bit request IDs
within a session; responses acknowledge completion, and there is no cross-session request replay.

```json
{"id":2,"type":"get_status"}
{"id":2,"type":"status","steamvr":"unavailable"}
```

Status is in memory. `unavailable` leaves the authenticated companion connected.
Only `status` is advertised; there are no brightness or hardware-write commands.
There are no unsolicited status events in this slice. Clients can poll `get_status`.
WebSocket ping/pong is supported; an established session expires after 300 seconds of inactivity.

Typed errors echo the request ID, then close the session:

```json
{"id":1,"type":"error","code":"wrong_identity"}
```

Error codes are `hello_required`, `already_initialized`, `wrong_identity`, and
`incompatible_protocol`. Both device and daemon identity must match. The client must also check
the returned identity before marking pairing ready. Every new connection starts with `hello`.

`python control.py scenario older` serves build `0.1.0-simulator` with protocol 1.0.
`scenario incompatible` serves protocol 2.0. `scenario wrong-daemon` changes the daemon identity.
Scenario changes disconnect existing sessions; status changes keep them connected.

Stage 2 can consume these wire types, certificate/credential expectations, endpoint behavior,
and network tests. Move the small contracts module into a shared crate when the daemon becomes
a second consumer. No general device framework or production pairing backend is needed here.
