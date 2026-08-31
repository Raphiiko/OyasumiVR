use std::io::Error;
use std::os::windows::ffi::OsStrExt;

use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::Threading::{
    CreateMutexW, GetCurrentProcess, OpenProcessToken, ReleaseMutex, WaitForSingleObject,
};

pub const PRIVILEGED_LAUNCHER_MUTEX: &str = "Global\\OyasumiVRPrivilegedLauncherInstall";
pub const PRIVILEGED_LAUNCHER_CLEANUP_TOKEN: &str = "cleanup.token";
pub const PRIVILEGED_LAUNCHER_CLEANUP_EXE: &str = "oyasumivr-elevated-cleanup.exe";

pub struct PrivilegedLauncherLock(HANDLE);

impl PrivilegedLauncherLock {
    pub fn acquire() -> std::result::Result<Self, Error> {
        let name: Vec<u16> = std::ffi::OsStr::new(PRIVILEGED_LAUNCHER_MUTEX)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let handle = unsafe { CreateMutexW(None, false, windows::core::PCWSTR(name.as_ptr())) }
            .map_err(Error::from)?;
        let wait = unsafe { WaitForSingleObject(handle, 30_000) };
        if wait != WAIT_OBJECT_0 && wait != WAIT_ABANDONED {
            unsafe {
                let _ = CloseHandle(handle);
            }
            return Err(Error::other(
                "timed out waiting for the privileged launcher lock",
            ));
        }
        Ok(Self(handle))
    }
}

impl Drop for PrivilegedLauncherLock {
    fn drop(&mut self) {
        unsafe {
            let _ = ReleaseMutex(self.0);
            let _ = CloseHandle(self.0);
        }
    }
}

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
                Err(e) => Err(Error::from(e)),
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
                Err(e) => Err(Error::from(e)),
            }
        }
    }
}
impl Drop for QueryAccessToken {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

/// Runs a filesystem operation with the current account's non-elevated token.
pub fn with_unelevated_token<T>(
    operation: impl FnOnce() -> std::result::Result<T, Error>,
) -> std::result::Result<T, Error> {
    use windows::Win32::Security::{
        ImpersonateLoggedOnUser, RevertToSelf, TokenLinkedToken, TOKEN_LINKED_TOKEN,
    };

    if !_is_app_elevated()? {
        return operation();
    }

    let token = QueryAccessToken::from_current_process()?;
    let mut linked = TOKEN_LINKED_TOKEN::default();
    let mut returned = 0u32;
    unsafe {
        GetTokenInformation(
            token.0,
            TokenLinkedToken,
            Some(&mut linked as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_LINKED_TOKEN>() as u32,
            &mut returned,
        )
        .map_err(Error::from)?;
    }

    struct Impersonation {
        token: HANDLE,
        active: bool,
    }
    impl Impersonation {
        fn finish(&mut self) -> std::result::Result<(), Error> {
            unsafe { RevertToSelf().map_err(Error::from)? };
            self.active = false;
            Ok(())
        }
    }
    impl Drop for Impersonation {
        fn drop(&mut self) {
            unsafe {
                if self.active {
                    let _ = RevertToSelf();
                }
                let _ = CloseHandle(self.token);
            }
        }
    }

    let mut impersonation = Impersonation {
        token: linked.LinkedToken,
        active: false,
    };
    unsafe { ImpersonateLoggedOnUser(impersonation.token).map_err(Error::from)? };
    impersonation.active = true;
    let result = operation();
    impersonation.finish()?;
    result
}

/// The Program Files directory, from the shell rather than from `%ProgramFiles%`, which any
/// process can hand to the one it launches.
pub fn program_files() -> std::result::Result<std::path::PathBuf, Error> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_ProgramFiles, SHGetKnownFolderPath, KF_FLAG_DEFAULT};

    unsafe {
        let path = SHGetKnownFolderPath(&FOLDERID_ProgramFiles, KF_FLAG_DEFAULT, None)
            .map_err(Error::from)?;
        if path.is_null() {
            return Err(Error::other("the shell returned no Program Files path"));
        }
        let text = path.to_string().map_err(Error::other);
        CoTaskMemFree(Some(path.0 as *const _));
        Ok(std::path::PathBuf::from(text?))
    }
}

pub fn privileged_cleanup_dir() -> std::result::Result<std::path::PathBuf, Error> {
    Ok(program_files()?.join("OyasumiVR").join("cleanup"))
}

/// Full control for SYSTEM and Administrators, read and execute for everyone else, owned by
/// Administrators, and protected so nothing is inherited.
pub(crate) const DIRECTORY_DESCRIPTOR: &str =
    "O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;WD)";

/// Replaces a directory's inherited permissions with an explicit, protected set: full control for
/// SYSTEM and Administrators, read and execute for everyone else.
///
/// `C:\Program Files` carries an inherit-only `CREATOR OWNER: Full control` entry, so a directory
/// created there grants the creating account full control whenever that account, rather than
/// Administrators, ends up as the owner. Everything under the privileged directory is executed
/// elevated, so it has to be unwritable for the user regardless of who created it.
pub fn protect_directory(path: &std::path::Path) -> std::result::Result<(), Error> {
    set_path_security(path, DIRECTORY_DESCRIPTOR)
}

/// Lets the current user remove a finished cleanup helper without granting write access.
pub fn allow_user_cleanup(
    directory: &std::path::Path,
    executable: &std::path::Path,
    user_sid: &str,
) -> std::result::Result<(), Error> {
    const READ_EXECUTE: u32 = 0x0012_00a9;
    const DELETE: u32 = 0x0001_0000;
    const DELETE_CHILD: u32 = 0x0000_0040;
    let directory_rights = READ_EXECUTE | DELETE | DELETE_CHILD;
    let file_rights = READ_EXECUTE | DELETE;
    let directory_descriptor = format!(
        "O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;{directory_rights:#x};;;{user_sid})"
    );
    let file_descriptor =
        format!("O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;{file_rights:#x};;;{user_sid})");
    set_path_security(executable, &file_descriptor)?;
    set_path_security(directory, &directory_descriptor)
}

fn set_path_security(path: &std::path::Path, descriptor: &str) -> std::result::Result<(), Error> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SetNamedSecurityInfoW,
        SDDL_REVISION_1, SE_FILE_OBJECT,
    };
    use windows::Win32::Security::{
        GetSecurityDescriptorDacl, GetSecurityDescriptorOwner, ACL, DACL_SECURITY_INFORMATION,
        OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
        PSID,
    };

    let mut wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let descriptor: Vec<u16> = descriptor
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut security = PSECURITY_DESCRIPTOR::default();
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(descriptor.as_ptr()),
            SDDL_REVISION_1,
            &mut security,
            None,
        )
        .map_err(Error::from)?;

        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut present = windows::core::BOOL::from(false);
        let mut defaulted = windows::core::BOOL::from(false);
        let read = GetSecurityDescriptorDacl(security, &mut present, &mut dacl, &mut defaulted);
        if read.is_err() || !present.as_bool() {
            let _ = LocalFree(Some(HLOCAL(security.0)));
            return Err(Error::other("the built-in security descriptor has no DACL"));
        }

        // Administrators as the owner, so no account keeps implicit WRITE_DAC over the directory.
        let mut owner = PSID::default();
        let read_owner = GetSecurityDescriptorOwner(security, &mut owner, &mut defaulted);
        if read_owner.is_err() || owner.is_invalid() {
            let _ = LocalFree(Some(HLOCAL(security.0)));
            return Err(Error::other(
                "the built-in security descriptor has no owner",
            ));
        }

        let result = SetNamedSecurityInfoW(
            windows::core::PWSTR(wide.as_mut_ptr()),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION
                | DACL_SECURITY_INFORMATION
                | PROTECTED_DACL_SECURITY_INFORMATION,
            Some(owner),
            None,
            Some(dacl),
            None,
        );
        let _ = LocalFree(Some(HLOCAL(security.0)));
        if result.is_err() {
            return Err(Error::from_raw_os_error(result.0 as i32));
        }
    }
    Ok(())
}

/// The SID of the user this process runs as, for the scheduled task's principal and DACL.
pub fn current_user_sid() -> std::result::Result<String, Error> {
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::{TokenUser, TOKEN_USER};

    let token = QueryAccessToken::from_current_process()?;
    unsafe {
        let mut size = 0u32;
        // deliberately ignored: the first call only reports the size we need
        let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut size);
        if size == 0 {
            return Err(Error::other("could not size the token user information"));
        }
        // u64 elements, because TOKEN_USER holds a pointer and a Vec<u8> only promises alignment 1
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(buffer.as_mut_ptr() as *mut _),
            size,
            &mut size,
        )
        .map_err(Error::from)?;
        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
        let mut text = windows::core::PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut text).map_err(Error::from)?;
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
    fn program_files_is_an_absolute_directory() {
        let real = super::program_files().expect("the shell always knows Program Files");
        assert!(real.is_absolute(), "{}", real.display());
        assert!(real.is_dir(), "{}", real.display());
    }

    #[test]
    fn the_directory_descriptor_windows_parses_matches_what_we_wrote() {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        use windows::Win32::Security::Authorization::{
            ConvertSecurityDescriptorToStringSecurityDescriptorW,
            ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
        };
        use windows::Win32::Security::{
            DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
        };

        let wide: Vec<u16> = super::DIRECTORY_DESCRIPTOR
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let mut parsed = PSECURITY_DESCRIPTOR::default();
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(wide.as_ptr()),
                SDDL_REVISION_1,
                &mut parsed,
                None,
            )
            .expect("Windows must accept the descriptor we apply to the privileged tree");

            let mut back = windows::core::PWSTR::null();
            ConvertSecurityDescriptorToStringSecurityDescriptorW(
                parsed,
                SDDL_REVISION_1,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut back,
                None,
            )
            .expect("and must be able to write it back out");
            let text = back.to_string().unwrap();
            let _ = LocalFree(Some(HLOCAL(back.0 as *mut _)));
            let _ = LocalFree(Some(HLOCAL(parsed.0)));

            assert!(text.contains("O:BA"), "Administrators must own it: {text}");
            assert!(text.contains("D:P"), "the DACL must be protected: {text}");
            assert!(text.contains("FA;;;SY"), "{text}");
            assert!(text.contains("FA;;;BA"), "{text}");
        }
    }

    #[test]
    fn current_user_sid_looks_like_a_sid() {
        let sid = super::current_user_sid().expect("the current process always has a user");
        assert!(sid.starts_with("S-1-"), "unexpected sid: {sid}");
        assert!(sid.len() > 8, "suspiciously short sid: {sid}");
    }
}
