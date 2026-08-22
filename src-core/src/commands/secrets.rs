use base64::{engine::general_purpose::STANDARD, Engine};
use windows::Win32::{
    Foundation::HLOCAL,
    Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    },
};
use windows_core::{Owned, PCWSTR};

fn blob(bytes: &[u8]) -> Result<CRYPT_INTEGER_BLOB, String> {
    Ok(CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(bytes.len()).map_err(|_| "Secret is too large")?,
        pbData: bytes.as_ptr().cast_mut(),
    })
}

fn copy_output(output: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let allocation = unsafe { Owned::new(HLOCAL(output.pbData.cast())) };
    if output.cbData == 0 {
        drop(allocation);
        return Vec::new();
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let result = bytes.to_vec();
    drop(allocation);
    result
}

fn protect(secret: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(secret)?;
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    }
    .map_err(|error| error.to_string())?;
    Ok(copy_output(output))
}

fn unprotect(secret: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(secret)?;
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    }
    .map_err(|error| error.to_string())?;
    Ok(copy_output(output))
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
