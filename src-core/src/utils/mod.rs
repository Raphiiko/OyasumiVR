use log::error;
use serde::Serialize;
use std::{
    os::raw::c_char,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sysinfo::{ProcessExt, Signal, System, SystemExt};
use tauri::Emitter;
use tokio::sync::Mutex;

use crate::globals::{TAURI_APP_HANDLE, TAURI_CLI_MATCHES};

lazy_static! {
    static ref SYSINFO: Mutex<System> = Mutex::new(System::new_all());
    static ref LAST_MEM_DIALOG: Mutex<u128> = Mutex::new(0);
}

pub mod models;
pub mod profiling;
pub mod serialization;
pub mod sidecar_manager;

pub fn init() {
    // Refresh processes at least every second
    tokio::task::spawn(async {
        loop {
            {
                let mut sysinfo_guard = SYSINFO.lock().await;
                let sysinfo = &mut *sysinfo_guard;
                sysinfo.refresh_processes();
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}

pub async fn is_process_active(process_name: &str, refresh_processes: bool) -> bool {
    let mut sysinfo_guard = SYSINFO.lock().await;
    let sysinfo = &mut *sysinfo_guard;
    if refresh_processes {
        sysinfo.refresh_processes();
    }
    let processes = sysinfo.processes_by_exact_name(process_name);
    processes.count() > 0
}

pub async fn stop_process(process_name: &str, kill: bool) {
    let mut sysinfo_guard = SYSINFO.lock().await;
    let sysinfo = &mut *sysinfo_guard;
    sysinfo.refresh_processes();
    let processes = sysinfo.processes_by_exact_name(process_name);
    for process in processes {
        if kill {
            let _ = process.kill_with(Signal::Kill);
        } else if process.kill_with(Signal::Term).is_none() {
            if process.kill_with(Signal::Quit).is_none() {
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
