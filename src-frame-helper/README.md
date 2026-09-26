# Steam Frame helper

`oyasumivr-frame-helper` runs on a paired Steam Frame as a systemd user service. OyasumiVR installs
it over SSH during pairing and then talks to it over WSS.

```text
oyasumivr-frame-helper info              # version and accepted protocol range, as JSON
oyasumivr-frame-helper serve [DATA_DIR]  # defaults to ~/.local/share/oyasumivr_helper
```

`serve` reads the port from `DATA_DIR/config.json`, creates `DATA_DIR/tls/` on first start, and
accepts a WebSocket upgrade only when its `Authorization: Bearer` token equals the contents of
`DATA_DIR/clients/<pc-id>`, where the PC names itself in the `X-OyasumiVR-PC` header.

## Building

`npm run start:ui` and `npm run _build:pre` build it through `build.mjs` for
`aarch64-unknown-linux-gnu`. That needs [cargo-zigbuild](https://github.com/rust-cross/cargo-zigbuild)
and Zig:

```text
cargo install cargo-zigbuild --locked
pip install ziglang
```

A Dev build without them skips the helper with a warning. Steam and standalone builds fail.

Tests run on the host: `cargo test`.
