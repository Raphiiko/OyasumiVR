use std::sync::atomic::Ordering;

use log::info;
use serde_json::{Map, Value};

#[tauri::command]
pub async fn set_telemetry_enabled(enable: bool) {
    let initialized = { *super::TELEMETRY_INITIALIZED.lock().await };
    let is_enabled = super::TELEMETRY_ENABLED.load(Ordering::Relaxed);
    if !initialized || is_enabled != enable {
        if enable {
            info!("[Core] Enabling telemetry");
        } else {
            info!("[Core] Disabling telemetry");
        }
        super::TELEMETRY_ENABLED.store(enable, Ordering::Relaxed);
        if !initialized {
            super::init_telemetry().await;
        }
    }
}

/// Resolves only once OpenPanel accepted the event, so the UI can retry an event that did not arrive.
#[tauri::command]
pub async fn track_event(name: String, props: Option<Map<String, Value>>) -> Result<(), String> {
    if !super::TELEMETRY_ENABLED.load(Ordering::Relaxed) {
        return Err("telemetry is disabled in the core".into());
    }
    super::send_event(&name, props).await
}
