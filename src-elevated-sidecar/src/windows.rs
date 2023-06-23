use std::{ffi::OsStr, os::windows::prelude::OsStrExt, ptr};
use windows_sys::Win32::UI::Shell::ShellExecuteW;

pub fn relaunch_with_elevation(main_port: u32, main_pid: u32, force_exit: bool) {
    // Get executable path
    let exe_path = std::env::current_exe().unwrap();
    let path = exe_path.as_os_str();
    let mut path_result: Vec<_> = path.encode_wide().collect();
    path_result.push(0);
    let path = path_result;
    // Get port parameter
    let mut port_result: Vec<_> = OsStr::new(format!("{main_port} {main_pid}").as_str())
        .encode_wide()
        .collect();
    port_result.push(0);
    let port = port_result;
    // Run as administrator
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
    // Quit non-admin process if successful (self)
    if r > 32 || force_exit {
        std::process::exit(0);
    }
}
