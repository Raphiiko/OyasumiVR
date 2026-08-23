//! Signs the elevated sidecar with the same minisign key the Tauri updater uses, writing
//! `<file>.minisig` with a fixed trusted comment that the launcher requires.
//!
//! Usage: sign-elevated-sidecar <file-to-sign>
//!
//! `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` come from the environment,
//! or from `.env.local` outside CI. Either a minisign key file or the base64 of one.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

const TRUSTED_COMMENT: &str = "oyasumivr-elevated-sidecar";

fn repo_root() -> PathBuf {
    // CARGO_MANIFEST_DIR is tools/sign-elevated-sidecar
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Reads a variable from the environment, falling back to `.env.local`. Deliberately a hand-rolled
/// parser: one `KEY=value` per line is all this needs, and an elevated build step is a poor place
/// to add a dependency.
fn from_env_or_dotenv(variable: &str) -> Option<String> {
    if let Ok(value) = std::env::var(variable) {
        if !value.trim().is_empty() {
            return Some(value);
        }
    }
    let contents = std::fs::read_to_string(repo_root().join(".env.local")).ok()?;
    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        if name.trim() == variable {
            let value = value.trim().trim_matches('"');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Accepts a minisign key file, or the base64 of one. Tauri stores the base64 form, so a key copied
/// straight from CI secrets works without reformatting.
fn parse_key(raw: &str) -> Result<minisign::SecretKeyBox, String> {
    let raw = raw.trim();
    if let Ok(boxed) = minisign::SecretKeyBox::from_string(raw) {
        if raw.starts_with("untrusted comment:") {
            return Ok(boxed);
        }
    }
    let decoded = base64_decode(raw).ok_or_else(|| "the key is neither a minisign key file nor base64".to_string())?;
    let text = String::from_utf8(decoded).map_err(|_| "the decoded key is not text".to_string())?;
    minisign::SecretKeyBox::from_string(text.trim())
        .map_err(|e| format!("cannot parse the decoded key: {e}"))
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut bits = 0u32;
    let mut count = 0u32;
    let mut out = Vec::new();
    for byte in input.bytes() {
        if byte == b'=' || byte.is_ascii_whitespace() {
            continue;
        }
        let value = TABLE.iter().position(|c| *c == byte)? as u32;
        bits = (bits << 6) | value;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
        }
    }
    Some(out)
}

fn secret_key() -> Result<minisign::SecretKey, String> {
    // Always Some: given None, the minisign crate prompts on stdin, which would hang the build.
    let password = Some(
        from_env_or_dotenv("TAURI_SIGNING_PRIVATE_KEY_PASSWORD")
            .unwrap_or_default()
            .trim()
            .to_string(),
    );
    let raw = from_env_or_dotenv("TAURI_SIGNING_PRIVATE_KEY").ok_or_else(|| {
        "no TAURI_SIGNING_PRIVATE_KEY in the environment or .env.local".to_string()
    })?;
    parse_key(&raw)?
        .into_secret_key(password)
        .map_err(|e| format!("cannot unlock the signing key: {e}"))
}

/// Only a Dev build may go unsigned. An unreadable flavour counts as shippable, so a missing file
/// fails the build instead of quietly skipping the signature.
fn build_is_shippable() -> bool {
    std::fs::read_to_string(repo_root().join("src-core/src/flavour.rs"))
        .map(|s| !s.contains("BuildFlavour::Dev"))
        .unwrap_or(true)
}

fn main() -> ExitCode {
    let Some(target) = std::env::args().nth(1) else {
        eprintln!("usage: sign-elevated-sidecar <file-to-sign>");
        return ExitCode::from(2);
    };
    let target = PathBuf::from(target);

    let key = match secret_key() {
        Ok(key) => key,
        Err(message) => {
            if build_is_shippable() {
                eprintln!("[sign] {message}");
                eprintln!("[sign] This build's flavour is not Dev, so an unsigned sidecar would");
                eprintln!("[sign] ship and the privileged launcher would refuse to start it.");
                return ExitCode::FAILURE;
            }
            eprintln!("[sign] skipping signature: {message}");
            eprintln!("[sign] a Dev build uses the prompt-per-launch path, so this is fine");
            return ExitCode::SUCCESS;
        }
    };

    let file = match std::fs::File::open(&target) {
        Ok(file) => file,
        Err(e) => {
            eprintln!("[sign] cannot open {}: {e}", target.display());
            return ExitCode::FAILURE;
        }
    };

    let signature = match minisign::sign(
        None,
        &key,
        file,
        Some(TRUSTED_COMMENT),
        Some("signed by the OyasumiVR build"),
    ) {
        Ok(signature) => signature,
        Err(e) => {
            eprintln!("[sign] signing failed: {e}");
            return ExitCode::FAILURE;
        }
    };

    let mut out = target.clone().into_os_string();
    out.push(".minisig");
    if let Err(e) = std::fs::write(&out, signature.into_string()) {
        eprintln!("[sign] cannot write the signature: {e}");
        return ExitCode::FAILURE;
    }
    println!("[sign] signed {}", target.display());
    ExitCode::SUCCESS
}
