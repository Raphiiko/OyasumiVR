//! The core owns both elevation paths: the prompt-free scheduled task, and the direct prompt here
//! for builds that cannot use it.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, GetProcessId, WaitForSingleObject, INFINITE,
};
use windows::Win32::UI::Shell::{
    ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
use windows::core::PCWSTR;

#[derive(Debug)]
pub enum ElevateError {
    /// The user dismissed the UAC prompt, which is not a failure to report as one.
    Declined,
    /// The binary is not where we expected, which must not be reported as a declined prompt.
    Missing(String),
    Failed(String),
}

impl std::fmt::Display for ElevateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Declined => write!(f, "the user did not grant administrator access"),
            Self::Missing(path) => write!(f, "{path} does not exist"),
            Self::Failed(reason) => write!(f, "{reason}"),
        }
    }
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

/// Uses the Ex form, which is the one that hands back a process handle to wait on.
fn shell_execute(exe: &Path, arguments: &str) -> Result<windows::Win32::Foundation::HANDLE, ElevateError> {
    // checked first: for a missing file the shell returns ERROR_CANCELLED, same as a refusal
    if !exe.is_file() {
        return Err(ElevateError::Missing(exe.display().to_string()));
    }
    let verb = wide(OsStr::new("runas"));
    let file = wide(exe.as_os_str());
    let args = wide(OsStr::new(arguments));

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(args.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };

    unsafe {
        ShellExecuteExW(&mut info).map_err(|e| {
            if e.code().0 as u32 & 0xFFFF == ERROR_CANCELLED.0 {
                ElevateError::Declined
            } else {
                ElevateError::Failed(e.message())
            }
        })?;
    }
    if info.hProcess.is_invalid() {
        return Err(ElevateError::Failed(
            "no process handle came back from ShellExecuteExW".to_string(),
        ));
    }
    Ok(info.hProcess)
}

/// Runs an elevated process and waits for it, returning its exit code.
pub fn run_and_wait(exe: &Path, arguments: &str) -> Result<u32, ElevateError> {
    let handle = shell_execute(exe, arguments)?;
    unsafe {
        let waited = WaitForSingleObject(handle, INFINITE);
        let mut code = 0u32;
        let read = GetExitCodeProcess(handle, &mut code).is_ok();
        let _ = CloseHandle(handle);
        if waited != WAIT_OBJECT_0 || !read {
            return Err(ElevateError::Failed(
                "could not read the elevated process's exit code".to_string(),
            ));
        }
        Ok(code)
    }
}

/// Starts an elevated process and leaves it running, returning its pid. One prompt per launch, so
/// only debug builds take this path.
pub fn spawn(exe: &Path, arguments: &str) -> Result<u32, ElevateError> {
    let handle = shell_execute(exe, arguments)?;
    unsafe {
        let pid = GetProcessId(handle);
        let _ = CloseHandle(handle);
        if pid == 0 {
            return Err(ElevateError::Failed(
                "the elevated process reported no pid".to_string(),
            ));
        }
        Ok(pid)
    }
}
