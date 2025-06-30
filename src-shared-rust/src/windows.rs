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
pub struct QueryAccessToken(HANDLE);
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
