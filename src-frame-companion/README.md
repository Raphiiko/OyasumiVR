# Steam Frame companion

Linux helper used by OyasumiVR to communicate with the headset's OpenVR runtime.

## Build

With an ARM64 Linux toolchain configured, run from this directory:

```sh
cargo build --locked --release --target aarch64-unknown-linux-gnu
```

## Run

Desktop pairing provisions the configuration and TLS credentials. It places `release.json` beside the executable.
Keep the configuration and TLS private key readable only by their owner, with mode `0600`.

```sh
oyasumivr-frame-companion serve --config /absolute/path/to/state/config.json
```

See [config.rs](src/config.rs) for configuration fields. `openvr_library_path` optionally selects
an installed OpenVR library.

## Remove

Run on the headset as the user who paired it:

```sh
bash "$HOME/.local/share/oyasumivr/frame/uninstall"
```

Desktop pairing drives installation, updates and recovery through `lifecycle.sh` over SSH.
The installed standalone uninstaller also works without the desktop.

## Check

```sh
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo fmt --check
```
