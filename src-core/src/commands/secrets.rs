use base64::{engine::general_purpose::STANDARD, Engine};

fn protect(secret: &[u8]) -> Result<Vec<u8>, String> {
    oyasumivr_frame_desktop::storage::protect(secret).map_err(|_| "Secret protection failed".into())
}

fn unprotect(secret: &[u8]) -> Result<Vec<u8>, String> {
    oyasumivr_frame_desktop::storage::unprotect(secret).map_err(|_| "Secret recovery failed".into())
}
#[tauri::command]
pub fn protect_secret(secret: String) -> Result<String, String> {
    Ok(STANDARD.encode(protect(secret.as_bytes())?))
}

#[tauri::command]
pub fn unprotect_secret(secret: String) -> Result<String, String> {
    let protected = STANDARD.decode(secret).map_err(|error| error.to_string())?;
    String::from_utf8(unprotect(&protected)?).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_unicode_text() {
        let secret = "user@example.com:pässword:日本語".to_string();
        let protected = protect_secret(secret.clone()).unwrap();

        assert_ne!(protected, secret);
        assert_eq!(unprotect_secret(protected).unwrap(), secret);
        assert_eq!(
            unprotect_secret(protect_secret(String::new()).unwrap()).unwrap(),
            ""
        );
    }

    #[test]
    fn rejects_invalid_input() {
        assert!(unprotect_secret("not base64".to_string()).is_err());
        assert!(unprotect_secret(STANDARD.encode("not dpapi")).is_err());
    }
}
