use log::error;
use serde::Serialize;
use std::{
    ffi::OsStr,
    iter::once,
    os::raw::c_char,
    os::windows::ffi::OsStrExt,
    os::windows::process::CommandExt,
    path::Path,
    process::Command,
    sync::LazyLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::Emitter;
use tokio::sync::Mutex;
use windows::Win32::{
    Foundation::{ERROR_MORE_DATA, ERROR_SUCCESS},
    System::RestartManager::{
        RmEndSession, RmGetList, RmRegisterResources, RmStartSession, CCH_RM_SESSION_KEY,
        RM_PROCESS_INFO,
    },
};
use windows_core::{PCWSTR, PWSTR};
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

use crate::globals::{TAURI_APP_HANDLE, TAURI_CLI_MATCHES};

static SYSINFO: LazyLock<Mutex<System>> = LazyLock::new(|| Mutex::new(System::new_all()));

pub mod models;
pub mod serialization;
pub mod sidecar_manager;

pub fn init() {
    // Refresh processes at least every second
    tokio::task::spawn(async {
        loop {
            {
                let mut sysinfo_guard = SYSINFO.lock().await;
                let sysinfo = &mut *sysinfo_guard;
                sysinfo.refresh_processes(ProcessesToUpdate::All, true);
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}

pub async fn is_process_active(process_name: &str, refresh_processes: bool) -> bool {
    let mut sysinfo_guard = SYSINFO.lock().await;
    let sysinfo = &mut *sysinfo_guard;
    if refresh_processes {
        sysinfo.refresh_processes(ProcessesToUpdate::All, true);
    }
    let processes = sysinfo.processes_by_exact_name(OsStr::new(process_name));
    processes.count() > 0
}

pub async fn process_ids(process_name: &str) -> Vec<u32> {
    let sysinfo_guard = SYSINFO.lock().await;
    sysinfo_guard
        .processes_by_exact_name(OsStr::new(process_name))
        .map(|process| process.pid().as_u32())
        .collect()
}

/// Ids of the processes that currently hold `path` open. Empty when nothing holds it, or on failure.
pub fn processes_holding_file(path: &Path) -> Vec<u32> {
    let mut session_key = [0u16; CCH_RM_SESSION_KEY as usize + 1];
    let mut session = 0u32;
    let start = unsafe { RmStartSession(&mut session, None, PWSTR(session_key.as_mut_ptr())) };
    if start != ERROR_SUCCESS {
        error!(
            "[Core] Failed to start a Restart Manager session: {}",
            start.0
        );
        return vec![];
    }
    let holders = collect_file_holders(session, path);
    let _ = unsafe { RmEndSession(session) };
    holders
}

fn collect_file_holders(session: u32, path: &Path) -> Vec<u32> {
    let file: Vec<u16> = path.as_os_str().encode_wide().chain(once(0)).collect();
    if unsafe { RmRegisterResources(session, Some(&[PCWSTR(file.as_ptr())]), None, None) }
        != ERROR_SUCCESS
    {
        return vec![];
    }
    // size the buffer, then fetch the holders
    let (mut needed, mut count, mut reboot_reasons) = (0u32, 0u32, 0u32);
    if unsafe { RmGetList(session, &mut needed, &mut count, None, &mut reboot_reasons) }
        != ERROR_MORE_DATA
        || needed == 0
    {
        return vec![];
    }
    let mut infos = vec![RM_PROCESS_INFO::default(); needed as usize];
    count = needed;
    if unsafe {
        RmGetList(
            session,
            &mut needed,
            &mut count,
            Some(infos.as_mut_ptr()),
            &mut reboot_reasons,
        )
    } != ERROR_SUCCESS
    {
        return vec![];
    }
    infos
        .iter()
        .take(count as usize)
        .map(|info| info.Process.dwProcessId)
        .collect()
}

/// Without `kill`, this only requests a close: the target may ignore it, so the caller must escalate.
pub async fn stop_process(process_name: &str, kill: bool) {
    let mut sysinfo_guard = SYSINFO.lock().await;
    let sysinfo = &mut *sysinfo_guard;
    sysinfo.refresh_processes(ProcessesToUpdate::All, true);
    for process in sysinfo.processes_by_exact_name(OsStr::new(process_name)) {
        let pid = process.pid();
        match Command::new("taskkill.exe")
            .args(taskkill_args(pid, kill))
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            Ok(output) if !output.status.success() => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                error!(
                    "[Core] Failed to stop process {process_name} ({pid}): {} {}",
                    output.status,
                    stderr.trim()
                );
            }
            Err(e) => error!("[Core] Failed to stop process {process_name} ({pid}): {e}"),
            Ok(_) => {}
        }
    }
}

fn taskkill_args(pid: Pid, kill: bool) -> Vec<String> {
    let mut args = vec![String::from("/PID"), pid.to_string()];
    if kill {
        args.push(String::from("/F"));
    }
    args
}

pub fn get_time() -> u128 {
    let now = SystemTime::now();
    let since_the_epoch = now.duration_since(UNIX_EPOCH).expect("Time went backwards");
    since_the_epoch.as_millis()
}

pub async fn send_event<S: Serialize + Clone>(event: &str, payload: S) {
    let app_handle_guard = TAURI_APP_HANDLE.lock().await;
    let app_handle = app_handle_guard.as_ref().unwrap();
    match app_handle.emit(event, payload) {
        Ok(_) => {}
        Err(e) => {
            error!("[Core] Failed to send event {event}: {e}");
        }
    };
}

pub async fn cli_core_mode() -> models::CoreMode {
    let default = "release";
    let match_guard = TAURI_CLI_MATCHES.lock().await;
    let mode = match match_guard.as_ref().unwrap().args.get("core-mode") {
        Some(data) => data.value.as_str().unwrap_or(default),
        None => default,
    };
    // Determine the correct mode
    match mode {
        "dev" => models::CoreMode::Dev,
        "release" => models::CoreMode::Release,
        _ => {
            error!("[Core] Invalid core mode specified. Defaulting to release mode.");
            models::CoreMode::Release
        }
    }
}

pub async fn cli_sidecar_overlay_mode() -> models::OverlaySidecarMode {
    let default = "release";
    let match_guard = TAURI_CLI_MATCHES.lock().await;
    let mode = match match_guard
        .as_ref()
        .unwrap()
        .args
        .get("overlay-sidecar-mode")
    {
        Some(data) => data.value.as_str().unwrap_or(default),
        None => default,
    };
    // Determine the correct mode
    match mode {
        "dev" => models::OverlaySidecarMode::Dev,
        "release" => models::OverlaySidecarMode::Release,
        _ => {
            error!("[Core] Invalid overlay sidecar mode specified. Defaulting to release mode.");
            models::OverlaySidecarMode::Release
        }
    }
}

pub fn convert_char_array_to_string(slice: &[c_char]) -> Option<String> {
    let trimmed_array: Vec<u8> = slice
        .iter()
        .map(|&c| c as u8)
        .take_while(|&x| x != 0)
        .collect();

    String::from_utf8(trimmed_array).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graceful_stop_never_forces() {
        assert_eq!(taskkill_args(Pid::from_u32(1234), false), ["/PID", "1234"]);
        assert_eq!(
            taskkill_args(Pid::from_u32(1234), true),
            ["/PID", "1234", "/F"]
        );
    }
}
