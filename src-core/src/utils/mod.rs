use human_bytes::human_bytes;
use log::{error, warn};
use serde::Serialize;
use std::{
    os::raw::c_char,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, PidExt, Process, ProcessExt, Signal, System, SystemExt};
use tauri::Manager;
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
    match app_handle.emit_all(event, payload) {
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

pub async fn cli_sidecar_mdns_mode() -> models::MdnsSidecarMode {
    let default = "release";
    let match_guard = TAURI_CLI_MATCHES.lock().await;
    let mode = match match_guard.as_ref().unwrap().args.get("mdns-sidecar-mode") {
        Some(data) => data.value.as_str().unwrap_or(default),
        None => default,
    };
    // Determine the correct mode
    match mode {
        "dev" => models::MdnsSidecarMode::Dev,
        "release" => models::MdnsSidecarMode::Release,
        _ => {
            error!("[Core] Invalid mdns sidecar mode specified. Defaulting to release mode.");
            models::MdnsSidecarMode::Release
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

pub async fn monitor_memory_usage(refresh_processes: bool) {
    let mut sysinfo_guard = SYSINFO.lock().await;
    let sysinfo = &mut *sysinfo_guard;
    // Get processes
    if refresh_processes {
        sysinfo.refresh_processes();
    }
    let processes = sysinfo.processes();
    let parent_process_id = std::process::id();
    // Collect all child process IDs
    let mut process_ids: Vec<u32> = vec![];
    loop {
        let mut found = false;
        for process in processes.values() {
            let pid = process.pid().as_u32();
            if process_ids.contains(&pid) {
                continue;
            }
            if let Some(parent_pid) = process.parent() {
                let parent_pid = parent_pid.as_u32();
                if process_ids.contains(&parent_pid) || parent_pid == parent_process_id {
                    process_ids.push(pid);
                    found = true;
                }
            }
        }
        if !found {
            break;
        }
    }
    // Notify if any process memory usage is too high
    let mut children: Vec<&Process> = Vec::new();
    let mut last_mem_dialog = {
        let last_mem_dialog_guard = LAST_MEM_DIALOG.lock().await;
        *last_mem_dialog_guard
    };
    for pid in process_ids {
        let ppid = &Pid::from_u32(pid);
        let process = processes.get(ppid).unwrap();
        children.push(&process);
        let mem_b = process.memory();
        if mem_b >= 1024000000 {
            let mem = human_bytes(mem_b as f64);
            warn!(
                "[Core] SUBPROCESS \"{}\" IS USING {} OF MEMORY.",
                process.name(),
                mem
            );
            if last_mem_dialog + 30000 < get_time() {
                let _ = tauri::api::dialog::MessageDialogBuilder::new(
                    "Possible Memory Leak Detected",
                    &format!(
                        "OyasumiVR's subprocess \"{}\" (PID:{}) is using {} of memory. This is highly unlikely to happen, and likely indicates the presence of a memory leak. If you see this, please contact a developer.",
                        process.name(),
                        process.pid().as_u32(),
                        mem
                    ),
                )
                .kind(tauri::api::dialog::MessageDialogKind::Error)
                .show(|_|{});
                let mut last_mem_dialog_guard = LAST_MEM_DIALOG.lock().await;
                *last_mem_dialog_guard = get_time();
                last_mem_dialog = get_time();
            }
        }
    }
}
