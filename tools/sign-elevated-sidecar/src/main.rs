//! Signs the elevated sidecar with the same minisign key the Tauri updater uses, writing
//! `<file>.minisig` with a fixed trusted comment that the launcher requires.
//!
//! Usage: sign-elevated-sidecar --flavour=<Dev|Standalone|Steam> --public-key=<base64> <file>
//!
//! `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` come from the environment.
//! The key is either a minisign key file, the base64 of one, or a path to one.

use std::path::PathBuf;
use std::process::ExitCode;

const TRUSTED_COMMENT: &str = "oyasumivr-elevated-sidecar";

struct Arguments {
    target: PathBuf,
    /// Only a Dev build may go unsigned, so an unrecognised flavour has to count as shippable.
    shippable: bool,
    public_key: String,
}

fn parse_arguments(raw: impl Iterator<Item = String>) -> Result<Arguments, String> {
    let mut target = None;
    let mut flavour = None;
    let mut public_key = None;
    for argument in raw {
        if let Some(value) = argument.strip_prefix("--flavour=") {
            flavour = Some(value.to_string());
        } else if let Some(value) = argument.strip_prefix("--public-key=") {
            public_key = Some(value.to_string());
        } else if argument.starts_with("--") {
            return Err(format!("unknown option {argument}"));
        } else if target.replace(PathBuf::from(argument)).is_some() {
            return Err("only one file can be signed at a time".to_string());
        }
    }
    Ok(Arguments {
        target: target.ok_or("no file to sign")?,
        shippable: flavour.ok_or("no --flavour")? != "Dev",
        public_key: public_key.ok_or("no --public-key")?,
    })
}

/// The text of a minisign key file, from any of the forms Tauri accepts.
fn key_text(raw: &str) -> Result<String, String> {
    const HEADER: &str = "untrusted comment:";
    let raw = raw.trim();
    if raw.starts_with(HEADER) {
        return Ok(raw.to_string());
    }
    if let Some(text) = base64_decode(raw).and_then(|d| String::from_utf8(d).ok()) {
        if text.trim_start().starts_with(HEADER) {
            return Ok(text.trim().to_string());
        }
    }
    let contents = std::fs::read_to_string(raw).map_err(|_| {
        "the key is not a minisign key file, base64, or a readable path".to_string()
    })?;
    Ok(contents.trim().to_string())
}

/// Standard base64, strictly: padding only at the end, and no bits left over.
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut bits = 0u32;
    let mut count = 0u32;
    let mut padded = false;
    let mut out = Vec::new();
    for byte in input.bytes() {
        if byte.is_ascii_whitespace() {
            continue;
        }
        if byte == b'=' {
            padded = true;
            continue;
        }
        if padded {
            return None;
        }
        let value = TABLE.iter().position(|c| *c == byte)? as u32;
        bits = (bits << 6) | value;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
        }
    }
    // Whatever is left is a truncated group, so it cannot be a whole character and its bits
    // cannot be set.
    if count >= 6 || bits & ((1u32 << count) - 1) != 0 {
        return None;
    }
    Some(out)
}

fn environment(variable: &str) -> Option<String> {
    std::env::var(variable)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn secret_key() -> Result<minisign::SecretKey, String> {
    // Always Some: given None, the minisign crate prompts on stdin, which would hang the build.
    let password = Some(
        environment("TAURI_SIGNING_PRIVATE_KEY_PASSWORD")
            .unwrap_or_default()
            .trim()
            .to_string(),
    );
    let raw = environment("TAURI_SIGNING_PRIVATE_KEY")
        .ok_or_else(|| "TAURI_SIGNING_PRIVATE_KEY is not set".to_string())?;
    minisign::SecretKeyBox::from_string(&key_text(&raw)?)
        .map_err(|e| format!("cannot read the signing key: {e}"))?
        .into_secret_key(password)
        .map_err(|e| format!("cannot unlock the signing key: {e}"))
}

fn public_key(raw: &str) -> Result<minisign::PublicKey, String> {
    minisign::PublicKeyBox::from_string(&key_text(raw)?)
        .map_err(|e| format!("cannot read the public key: {e}"))?
        .into_public_key()
        .map_err(|e| format!("cannot read the public key: {e}"))
}

fn main() -> ExitCode {
    let arguments = match parse_arguments(std::env::args().skip(1)) {
        Ok(arguments) => arguments,
        Err(message) => {
            eprintln!("[sign] {message}");
            eprintln!("[sign] usage: sign-elevated-sidecar --flavour=<Dev|Standalone|Steam> --public-key=<base64> <file>");
            return ExitCode::from(2);
        }
    };

    let key = match secret_key() {
        Ok(key) => key,
        Err(message) => {
            if arguments.shippable {
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

    // Signing checks the result against the key the app ships, so the wrong key fails the build
    // rather than the user's launcher.
    let public_key = match public_key(&arguments.public_key) {
        Ok(public_key) => public_key,
        Err(message) => {
            eprintln!("[sign] {message}");
            return ExitCode::FAILURE;
        }
    };

    let file = match std::fs::File::open(&arguments.target) {
        Ok(file) => file,
        Err(e) => {
            eprintln!("[sign] cannot open {}: {e}", arguments.target.display());
            return ExitCode::FAILURE;
        }
    };

    let signature = match minisign::sign(
        Some(&public_key),
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

    let mut out = arguments.target.clone().into_os_string();
    out.push(".minisig");
    if let Err(e) = std::fs::write(&out, signature.into_string()) {
        eprintln!("[sign] cannot write the signature: {e}");
        return ExitCode::FAILURE;
    }
    println!("[sign] signed {}", arguments.target.display());
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    const UPDATER_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEVGOEI4QTQ2Rjk1NEMwNTUKUldSVndGVDVSb3FMN3hIanNsbVVDdVk1MkE2MVpVWERJeTdUVVRzZ1JpanVQTmNXYWJGVHhUSVIK";

    fn arguments(raw: &[&str]) -> Result<Arguments, String> {
        parse_arguments(raw.iter().map(|s| s.to_string()))
    }

    #[test]
    fn base64_decodes_known_vectors() {
        assert_eq!(base64_decode("").unwrap(), b"");
        assert_eq!(base64_decode("Zg==").unwrap(), b"f");
        assert_eq!(base64_decode("Zm8=").unwrap(), b"fo");
        assert_eq!(base64_decode("Zm9v").unwrap(), b"foo");
        assert_eq!(base64_decode("Zm9vYmFy").unwrap(), b"foobar");
        assert_eq!(base64_decode("Zm9v\nYmFy").unwrap(), b"foobar");
    }

    #[test]
    fn base64_rejects_malformed_input() {
        assert!(base64_decode("Zm9-").is_none(), "not in the standard table");
        assert!(base64_decode("Zg=v").is_none(), "padding in the middle");
        assert!(base64_decode("Zh==").is_none(), "leftover bits are set");
        assert!(base64_decode("Z").is_none(), "a group of one");
    }

    #[test]
    fn base64_decodes_the_shipped_public_key() {
        let text = String::from_utf8(base64_decode(UPDATER_PUBLIC_KEY).unwrap()).unwrap();
        assert!(text.starts_with("untrusted comment: minisign public key:"));
        assert!(public_key(UPDATER_PUBLIC_KEY).is_ok());
    }

    #[test]
    fn key_text_accepts_a_key_file_and_its_base64() {
        let file = "untrusted comment: x\nRWRVwFT5RoqL7xHjslmUCuY52A61ZUXDIy7TUTsgRijuPNcWabFTxTIR";
        assert_eq!(key_text(file).unwrap(), file);
        let decoded = String::from_utf8(base64_decode(UPDATER_PUBLIC_KEY).unwrap()).unwrap();
        assert_eq!(key_text(UPDATER_PUBLIC_KEY).unwrap(), decoded.trim());
    }

    #[test]
    fn key_text_rejects_something_that_is_neither() {
        assert!(key_text("not a key and not a path").is_err());
    }

    #[test]
    fn only_a_dev_flavour_may_go_unsigned() {
        assert!(
            !arguments(&["--flavour=Dev", "--public-key=k", "a.exe"])
                .unwrap()
                .shippable
        );
        for flavour in ["Standalone", "Steam", "", "dev", "DEV"] {
            let parsed = arguments(&[&format!("--flavour={flavour}"), "--public-key=k", "a.exe"]);
            assert!(
                parsed.unwrap().shippable,
                "{flavour} must count as shippable"
            );
        }
    }

    #[test]
    fn arguments_are_required_and_checked() {
        assert_eq!(
            arguments(&["--flavour=Steam", "--public-key=k", "a.exe"])
                .unwrap()
                .target,
            PathBuf::from("a.exe")
        );
        assert!(arguments(&["--public-key=k", "a.exe"]).is_err(), "flavour");
        assert!(arguments(&["--flavour=Steam", "a.exe"]).is_err(), "key");
        assert!(
            arguments(&["--flavour=Steam", "--public-key=k"]).is_err(),
            "file"
        );
        assert!(
            arguments(&["--flavour=Steam", "--public-key=k", "--wat", "a.exe"]).is_err(),
            "unknown option"
        );
        assert!(
            arguments(&["--flavour=Steam", "--public-key=k", "a.exe", "b.exe"]).is_err(),
            "two files"
        );
    }
}
