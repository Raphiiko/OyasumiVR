use log::error;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{System, SystemExt};
use tauri::Manager;
use tokio::sync::Mutex;

use crate::globals::TAURI_APP_HANDLE;

lazy_static! {
    static ref SYSINFO: Mutex<System> = Mutex::new(System::new_all());
}

pub async fn is_process_active(process_name: &str) -> bool {
    let mut sysinfo_guard = SYSINFO.lock().await;
    let sysinfo = &mut *sysinfo_guard;
    sysinfo.refresh_processes();
    let processes = sysinfo.processes_by_exact_name(process_name);
    processes.count() > 0
}

pub fn get_time() -> u128 {
    let now = SystemTime::now();
    let since_the_epoch = now.duration_since(UNIX_EPOCH).expect("Time went backwards");
    since_the_epoch.as_millis()
}

pub async fn send_event<S: Serialize + Clone>(event: &str, payload: S) {
    let app_handle_guard = TAURI_APP_HANDLE.lock().await;
    let app_handle = app_handle_guard.as_ref().unwrap();
    match app_handle.emit_all(event, payload) {
        Ok(_) => {}
        Err(e) => {
            error!("[Core] Failed to send event {}: {}", event, e);
        }
    };
}
