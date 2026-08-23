use minisign_verify::{PublicKey, Signature};
use std::io::{Error, ErrorKind, Read, Result};
use std::path::Path;

/// This key also signs the updater artifacts, so the trusted comment below is what ties a
/// signature to the sidecar specifically.
const PUBLIC_KEY: &str = oyasumivr_shared::ELEVATED_SIDECAR_PUBLIC_KEY;

/// Minisign signs the trusted comment too, so pinning it is as strong as the key check.
const EXPECTED_TRUSTED_COMMENT_PREFIX: &str = "oyasumivr-elevated-sidecar";

fn public_key() -> Result<PublicKey> {
    PublicKey::decode(PUBLIC_KEY.trim())
        .or_else(|_| PublicKey::from_base64(PUBLIC_KEY.trim()))
        .map_err(|e| Error::new(ErrorKind::InvalidData, format!("bad built-in public key: {e}")))
}

fn signature(sig_path: &Path) -> Result<Signature> {
    let raw = std::fs::read_to_string(sig_path)?;
    Signature::decode(&raw)
        .map_err(|e| Error::new(ErrorKind::InvalidData, format!("bad signature file: {e}")))
}

pub fn signature_path(exe: &Path) -> std::path::PathBuf {
    let mut path = exe.as_os_str().to_owned();
    path.push(".minisig");
    path.into()
}

/// A stable identifier for the signed content, used as the staged directory name. Ed25519 is
/// deterministic, so identical bytes always give an identical signature.
pub fn signature_id(sig_path: &Path) -> Result<String> {
    let raw = std::fs::read_to_string(sig_path)?;
    let line = raw
        .lines()
        .find(|l| !l.starts_with("untrusted comment:") && !l.is_empty())
        .ok_or_else(|| Error::new(ErrorKind::InvalidData, "signature file has no signature line"))?;
    Ok(line
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(48)
        .collect())
}

/// Streams the file through verification so a multi-megabyte binary is never held in memory.
pub fn verify(exe: &Path, sig_path: &Path) -> Result<()> {
    verify_with(&public_key()?, exe, sig_path)
}

pub fn verify_with(key: &PublicKey, exe: &Path, sig_path: &Path) -> Result<()> {
    let signature = signature(sig_path)?;

    let comment = signature.trusted_comment();
    if !comment.starts_with(EXPECTED_TRUSTED_COMMENT_PREFIX) {
        return Err(Error::new(
            ErrorKind::InvalidData,
            format!("refusing a signature for another role: {comment:?}"),
        ));
    }

    let mut file = std::fs::File::open(exe)?;
    let mut verifier = key
        .verify_stream(&signature)
        .map_err(|e| Error::new(ErrorKind::InvalidData, format!("cannot verify: {e}")))?;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        verifier.update(&buffer[..read]);
    }
    verifier
        .finalize()
        .map_err(|e| Error::new(ErrorKind::InvalidData, format!("signature rejected: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_id_is_stable_and_filename_safe() {
        let dir = std::env::temp_dir().join("oyasumi-sigid-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.minisig");
        std::fs::write(
            &path,
            "untrusted comment: signature from minisign\nRURVwFT5RoqL7/+abc==\ntrusted comment: oyasumivr-elevated-sidecar\nZZZ==\n",
        )
        .unwrap();

        let first = signature_id(&path).unwrap();
        let second = signature_id(&path).unwrap();
        assert_eq!(first, second);
        assert!(first.chars().all(|c| c.is_ascii_alphanumeric()));
        assert!(!first.is_empty());
    }

    #[test]
    fn signature_id_differs_for_different_signatures() {
        let dir = std::env::temp_dir().join("oyasumi-sigid-test2");
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.minisig");
        let b = dir.join("b.minisig");
        std::fs::write(&a, "untrusted comment: x\nAAAAbbbb==\n").unwrap();
        std::fs::write(&b, "untrusted comment: x\nCCCCdddd==\n").unwrap();
        assert_ne!(signature_id(&a).unwrap(), signature_id(&b).unwrap());
    }

    /// Signs a fixture with a throwaway key, exercising streaming, the key check and the pin.
    fn fixture(dir: &str, content: &[u8], comment: &str) -> (PublicKey, std::path::PathBuf, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(dir);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("sidecar.exe");
        std::fs::write(&exe, content).unwrap();

        let pair = minisign::KeyPair::generate_encrypted_keypair(Some("pw".into())).unwrap();
        // still encrypted in memory after generation
        let secret = pair
            .sk
            .to_box(None)
            .unwrap()
            .into_secret_key(Some("pw".into()))
            .unwrap();
        let signature = minisign::sign(
            None,
            &secret,
            std::fs::File::open(&exe).unwrap(),
            Some(comment),
            None,
        )
        .unwrap();
        let sig_path = signature_path(&exe);
        std::fs::write(&sig_path, signature.into_string()).unwrap();

        let key = PublicKey::from_base64(
            pair.pk.to_box().unwrap().into_string().lines().nth(1).unwrap(),
        )
        .unwrap();
        (key, exe, sig_path)
    }

    #[test]
    fn accepts_a_correctly_signed_binary() {
        let (key, exe, sig) = fixture("oyasumi-verify-ok", b"pretend this is a sidecar", "oyasumivr-elevated-sidecar");
        verify_with(&key, &exe, &sig).expect("a good signature must verify");
    }

    #[test]
    fn rejects_a_tampered_binary() {
        let (key, exe, sig) = fixture("oyasumi-verify-tamper", b"pretend this is a sidecar", "oyasumivr-elevated-sidecar");
        std::fs::write(&exe, b"malware").unwrap();
        assert!(verify_with(&key, &exe, &sig).is_err());
    }

    #[test]
    fn rejects_a_signature_from_another_key() {
        let (_, exe, sig) = fixture("oyasumi-verify-otherkey", b"pretend this is a sidecar", "oyasumivr-elevated-sidecar");
        let other = minisign::KeyPair::generate_encrypted_keypair(Some("pw".into())).unwrap();
        let stranger = PublicKey::from_base64(
            other.pk.to_box().unwrap().into_string().lines().nth(1).unwrap(),
        )
        .unwrap();
        assert!(verify_with(&stranger, &exe, &sig).is_err());
    }

    #[test]
    fn rejects_a_valid_signature_for_another_role() {
        // our key, our signature, wrong artifact
        let (key, exe, sig) = fixture("oyasumi-verify-role", b"some other tool we also signed", "oyasumivr-updater");
        let error = verify_with(&key, &exe, &sig).expect_err("must refuse another role");
        assert!(error.to_string().contains("another role"), "{error}");
    }

    /// Proves the committed public key and the real signing key are a pair, which the fixture
    /// tests above cannot catch. Skips when no signing key is available.
    #[test]
    fn the_committed_key_matches_the_real_signing_key() {
        use base64::Engine;

        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let read = |want: &str| -> Option<String> {
            if let Ok(value) = std::env::var(want) {
                if !value.trim().is_empty() {
                    return Some(value);
                }
            }
            let contents = std::fs::read_to_string(root.join(".env.local")).ok()?;
            contents.lines().find_map(|line| {
                let line = line.trim();
                if line.starts_with('#') {
                    return None;
                }
                let (name, value) = line.split_once('=')?;
                (name.trim() == want).then(|| value.trim().to_string())
            })
        };

        let (Some(raw), Some(password)) = (
            read("TAURI_SIGNING_PRIVATE_KEY"),
            read("TAURI_SIGNING_PRIVATE_KEY_PASSWORD"),
        ) else {
            eprintln!("no signing key available, skipping");
            return;
        };

        // stored as base64 of the key file, the form Tauri uses
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(raw.trim())
            .expect("the signing key must be base64");
        let text = String::from_utf8(decoded).expect("the decoded key must be text");
        let secret = minisign::SecretKeyBox::from_string(text.trim())
            .expect("the decoded key must parse")
            .into_secret_key(Some(password))
            .expect("the password must unlock the key");

        let dir = std::env::temp_dir().join("oyasumi-verify-realkey");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("sidecar.exe");
        std::fs::write(&exe, b"stand-in for the elevated sidecar").unwrap();
        let signature = minisign::sign(
            None,
            &secret,
            std::fs::File::open(&exe).unwrap(),
            Some("oyasumivr-elevated-sidecar"),
            None,
        )
        .unwrap();
        let sig_path = signature_path(&exe);
        std::fs::write(&sig_path, signature.into_string()).unwrap();

        verify(&exe, &sig_path).expect("the committed public key must match the signing key");
    }

    #[test]
    fn signature_path_appends_the_extension() {
        assert_eq!(
            signature_path(Path::new(r"C:\x\sidecar.exe")),
            Path::new(r"C:\x\sidecar.exe.minisig")
        );
    }
}
