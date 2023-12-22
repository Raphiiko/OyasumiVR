use std::sync::atomic::AtomicBool;

use log::info;
use serde_json::json;
use tauri_plugin_aptabase::EventTracker;
use tokio::sync::Mutex;

use crate::BUILD_FLAVOUR;

pub mod commands;

lazy_static! {
    pub static ref TELEMETRY_INITIALIZED: Mutex<bool> = Mutex::new(false);
    pub static ref TELEMETRY_ENABLED: AtomicBool = AtomicBool::new(false);
}

pub async fn init_telemetry(handle: &tauri::AppHandle) {
    *TELEMETRY_INITIALIZED.lock().await = true;
    if !TELEMETRY_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    info!("[Core] Initializing telemetry");
    let flavour = serde_json::to_string(&BUILD_FLAVOUR)
        .unwrap()
        .to_uppercase();
    handle.track_event("app_started", Some(json!({ "flavour": flavour.clone() })));
}
