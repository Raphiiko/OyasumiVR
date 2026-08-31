pub mod error_reporting;
pub mod handshake;
pub mod logging;
pub mod task;
pub mod windows;

/// Bumped by hand, only when the launcher's own behaviour changes. Every bump costs each user one
/// UAC prompt.
pub const PRIVILEGED_LAUNCHER_VERSION: u32 = 3;

/// The public half of the key that signs the elevated sidecar.
pub const ELEVATED_SIDECAR_PUBLIC_KEY: &str = include_str!("../elevated-sidecar-signing.pub");

/// The key's base64 line, recorded in `launcher.json` so the core can spot a launcher built with a
/// different key.
pub fn elevated_sidecar_key_id() -> &'static str {
    ELEVATED_SIDECAR_PUBLIC_KEY
        .lines()
        .find(|line| !line.starts_with("untrusted comment:") && !line.trim().is_empty())
        .unwrap_or("")
        .trim()
}

#[cfg(test)]
mod tests {
    /// The launcher verifies with the key committed here, the build signs with the key in
    /// `tauri.conf.json`. If they drift apart, the launcher refuses a correctly signed sidecar.
    #[test]
    fn the_committed_key_is_the_one_the_build_signs_with() {
        use base64::Engine;

        let conf = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("src-core/tauri.conf.json");
        let text = std::fs::read_to_string(&conf).expect("tauri.conf.json must be readable");
        let value: serde_json::Value = serde_json::from_str(&text).expect("must be valid json");
        let encoded = value["plugins"]["updater"]["pubkey"]
            .as_str()
            .expect("plugins.updater.pubkey must be a string");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("the updater key must be base64");
        let updater_key = String::from_utf8(decoded).expect("the updater key must be text");

        let updater_id = updater_key
            .lines()
            .find(|line| !line.starts_with("untrusted comment:") && !line.trim().is_empty())
            .unwrap_or("")
            .trim();
        assert_eq!(
            super::elevated_sidecar_key_id(),
            updater_id,
            "elevated-sidecar-signing.pub and plugins.updater.pubkey are different keys"
        );
    }

    #[test]
    fn the_key_id_is_the_base64_line_not_the_comment() {
        let id = super::elevated_sidecar_key_id();
        assert!(!id.is_empty());
        assert!(!id.contains("untrusted comment"));
        assert!(!id.contains(' '), "the key id must be a single token: {id}");
        assert!(id.starts_with("RW"), "minisign keys start with RW: {id}");
    }
}
