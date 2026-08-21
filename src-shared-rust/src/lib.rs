pub mod error_reporting;
pub mod handshake;
pub mod task;
pub mod windows;

/// Bumped by hand, only when the launcher's own behaviour changes. Every bump costs each user one
/// UAC prompt.
pub const PRIVILEGED_LAUNCHER_VERSION: u32 = 1;

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
    #[test]
    fn the_key_id_is_the_base64_line_not_the_comment() {
        let id = super::elevated_sidecar_key_id();
        assert!(!id.is_empty());
        assert!(!id.contains("untrusted comment"));
        assert!(!id.contains(' '), "the key id must be a single token: {id}");
        assert!(id.starts_with("RW"), "minisign keys start with RW: {id}");
    }
}
