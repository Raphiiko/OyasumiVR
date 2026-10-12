use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock,
    },
    time::Duration,
};

use log::info;
use serde_json::json;
use tauri_plugin_aptabase::EventTracker;
use tokio::sync::Mutex;

use crate::BUILD_FLAVOUR;

pub mod commands;

pub static TELEMETRY_INITIALIZED: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));
pub static TELEMETRY_ENABLED: LazyLock<AtomicBool> = LazyLock::new(|| AtomicBool::new(false));

pub async fn init_telemetry(handle: &tauri::AppHandle) {
    *TELEMETRY_INITIALIZED.lock().await = true;
    // the aptabase plugin starts a new session after 4 hours without events
    tokio::task::spawn(async {
        loop {
            tokio::time::sleep(Duration::from_secs(3600 * 7 / 2)).await;
            if TELEMETRY_ENABLED.load(Ordering::Relaxed) {
                let handle = crate::globals::TAURI_APP_HANDLE.lock().await;
                if let Some(handle) = handle.as_ref() {
                    let _ = handle.track_event("app_heartbeat", None);
                }
            }
        }
    });
    if !TELEMETRY_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    info!("[Core] Initializing telemetry");
    let flavour = serde_json::to_string(&BUILD_FLAVOUR)
        .unwrap()
        .to_uppercase();
    let _ = handle.track_event("app_started", Some(json!({ "flavour": flavour.clone() })));
}
