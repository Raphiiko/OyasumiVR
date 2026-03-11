use log::{error, info};
use std::{ffi::OsStr, os::windows::prelude::OsStrExt, ptr};
use windows_sys::Win32::UI::Shell::ShellExecuteW;

pub fn relaunch_with_elevation(main_port: u32, main_pid: u32, force_exit: bool) -> bool {
    // Get executable path
    let exe_path = match std::env::current_exe() {
        Ok(exe_path) => exe_path,
        Err(e) => {
            error!("[ELEVATION] Failed to resolve current executable path: {e}");
            return false;
        }
    };
    let path = exe_path.as_os_str();
    let mut path_result: Vec<_> = path.encode_wide().collect();
    path_result.push(0);
    let path = path_result;
    // Get port parameter
    let old_pid = std::process::id();
    let launch_args = format!("{main_port} {main_pid} {old_pid}");
    let mut port_result: Vec<_> = OsStr::new(&launch_args)
        .encode_wide()
        .collect();
    port_result.push(0);
    let port = port_result;
    // Run as administrator
    info!(
        "[ELEVATION] Requesting administrator privileges for {:?} with args: {}",
        exe_path, launch_args
    );
    let operation: Vec<u16> = OsStr::new("runas\0").encode_wide().collect();
    let r = unsafe {
        ShellExecuteW(
            0,
            operation.as_ptr(),
            path.as_ptr(),
            port.as_ptr(),
            ptr::null(),
            0,
        )
    };
    // Quit the non-admin helper only when the elevated launch actually succeeded.
    if r > 32 {
        info!("[ELEVATION] Elevation request was accepted by ShellExecuteW.");
        if force_exit {
            std::process::exit(0);
        }
        true
    } else {
        error!(
            "[ELEVATION] ShellExecuteW failed while requesting elevation (code={})",
            r as isize
        );
        false
    }
}
