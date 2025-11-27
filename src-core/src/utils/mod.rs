use log::error;
use serde::Serialize;
use std::{
    ffi::OsStr,
    os::raw::c_char,
    sync::LazyLock,
    time::{SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System};
use tauri::Emitter;
use tokio::sync::Mutex;

use crate::globals::{TAURI_APP_HANDLE, TAURI_CLI_MATCHES};

static SYSINFO: LazyLock<Mutex<System>> = LazyLock::new(|| Mutex::new(System::new_all()));

pub mod models;
pub mod profiling;
pub mod serialization;
pub mod sidecar_manager;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TrackedProcess {
    Steamvr,
    Vrchat,
}
impl TrackedProcess {
    pub fn name(&self) -> &OsStr {
        OsStr::new(match self {
            #[cfg(windows)]
            Self::Steamvr => "vrmonitor.exe",
            #[cfg(unix)]
            Self::Steamvr => "vrmonitor",
            Self::Vrchat => "VRChat.exe",
        })
    }
}
pub async fn is_process_active(process: TrackedProcess) -> bool {
    static ACTIVE_PROCESS: Mutex<Vec<(TrackedProcess, Pid)>> = Mutex::const_new(Vec::new());
    let mut sysinfo_guard = SYSINFO.lock().await;
    let mut active_guard = ACTIVE_PROCESS.lock().await;
    //first check if process which previously matches the name still exists
    if let Some(p) = active_guard.iter().position(|p| p.0 == process) {
        sysinfo_guard.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[active_guard[p].1]),
            true,
            ProcessRefreshKind::nothing().without_tasks(),
        );
        if sysinfo_guard
            .processes_by_exact_name(active_guard[p].0.name())
            .next()
            .is_some()
        {
            return true;
        } else {
            active_guard.swap_remove(p);
            return false;
        }
    } else {
        sysinfo_guard.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().without_tasks(),
        );
        let processes = sysinfo_guard
            .processes_by_exact_name(process.name())
            .collect::<Vec<_>>();
        if processes.len() == 0 {
            return false;
        } else {
            //even if there is multiple processes matching the name as long as one of them is running sysinfo would return something
            active_guard.push((process, processes[0].pid()));
            return true;
        }
    }
}
pub async fn quit_steamvr(kill: bool) {
    let sysinfo_guard = SYSINFO.lock().await;
    if is_process_active(TrackedProcess::Steamvr).await {
        //is_process_active already refreshes processes
        for process in sysinfo_guard.processes_by_exact_name(TrackedProcess::Steamvr.name()) {
            if kill
                || (process.kill_with(Signal::Term).is_none()
                    && process.kill_with(Signal::Quit).is_none())
            {
                let _ = process.kill_with(Signal::Kill);
            }
        }
    }
}

pub fn get_time() -> u128 {
    let now = SystemTime::now();
    let since_the_epoch = now.duration_since(UNIX_EPOCH).expect("Time went backwards");
    since_the_epoch.as_millis()
}

pub async fn send_event<S: Serialize + Clone>(event: &str, payload: S) {
    profiling::register_event(event).await;
    let app_handle_guard = TAURI_APP_HANDLE.lock().await;
    let app_handle = app_handle_guard.as_ref().unwrap();
    match app_handle.emit(event, payload) {
        Ok(_) => {}
        Err(e) => {
            error!("[Core] Failed to send event {}: {}", event, e);
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
