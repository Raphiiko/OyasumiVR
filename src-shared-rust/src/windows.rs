use std::io::Error;

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

pub fn is_elevated() -> bool {
    _is_app_elevated().unwrap_or(false)
}

/// On success returns a bool indicating if the current process has admin rights.
/// Otherwise returns an OS error.
///
/// This is unlikely to fail but if it does it's even more unlikely that you have admin permissions anyway.
/// Therefore the public function above simply eats the error and returns a bool.
fn _is_app_elevated() -> std::result::Result<bool, Error> {
    let token = QueryAccessToken::from_current_process()?;
    token.is_elevated()
}

/// A safe wrapper around querying Windows access tokens.
pub struct QueryAccessToken(pub(crate) HANDLE);
impl QueryAccessToken {
    pub fn from_current_process() -> std::result::Result<Self, Error> {
        unsafe {
            let mut handle = HANDLE::default();
            match OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle) {
                Ok(_) => Ok(Self(handle)),
                Err(e) => Err(Error::from_raw_os_error(e.code().0)),
            }
        }
    }

    /// On success returns a bool indicating if the access token has elevated privilidges.
    /// Otherwise returns an OS error.
    pub fn is_elevated(&self) -> std::result::Result<bool, Error> {
        unsafe {
            let mut elevation = TOKEN_ELEVATION::default();
            let size = std::mem::size_of::<TOKEN_ELEVATION>() as u32;
            let mut ret_size = 0u32;
            
            match GetTokenInformation(
                self.0,
                TokenElevation,
                Some(&mut elevation as *mut _ as *mut _),
                size,
                &mut ret_size,
            ) {
                Ok(_) => Ok(elevation.TokenIsElevated != 0),
                Err(e) => Err(Error::from_raw_os_error(e.code().0)),
            }
        }
    }
}
impl Drop for QueryAccessToken {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe { let _ = CloseHandle(self.0); }
        }
    }
}

/// The SID of the user this process runs as, for the scheduled task's principal and DACL.
pub fn current_user_sid() -> std::result::Result<String, Error> {
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::{TokenUser, TOKEN_USER};

    let token = QueryAccessToken::from_current_process()?;
    unsafe {
        let mut size = 0u32;
        // Deliberately ignored. The first call always fails with ERROR_INSUFFICIENT_BUFFER and
        // only reports the size we need.
        let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut size);
        if size == 0 {
            return Err(Error::other("could not size the token user information"));
        }
        let mut buffer = vec![0u8; size as usize];
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(buffer.as_mut_ptr() as *mut _),
            size,
            &mut size,
        )
        .map_err(|e| Error::from_raw_os_error(e.code().0))?;
        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
        let mut text = windows::core::PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut text)
            .map_err(|e| Error::from_raw_os_error(e.code().0))?;
        let sid = text.to_string().map_err(Error::other)?;
        let _ = windows::Win32::Foundation::LocalFree(Some(windows::Win32::Foundation::HLOCAL(
            text.0 as *mut _,
        )));
        Ok(sid)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn current_user_sid_looks_like_a_sid() {
        let sid = super::current_user_sid().expect("the current process always has a user");
        assert!(sid.starts_with("S-1-"), "unexpected sid: {sid}");
        assert!(sid.len() > 8, "suspiciously short sid: {sid}");
    }
}
