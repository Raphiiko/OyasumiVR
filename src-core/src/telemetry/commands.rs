use std::sync::atomic::Ordering;

use log::info;

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn set_telemetry_enabled(app_handle: tauri::AppHandle, enable: bool) {
    let initialized = { super::TELEMETRY_INITIALIZED.lock().await.clone() };
    let is_enabled = super::TELEMETRY_ENABLED.load(Ordering::Relaxed);
    if !initialized || is_enabled != enable {
        if enable {
            info!("[Core] Enabling telemetry");
        } else {
            info!("[Core] Disabling telemetry");
        }
        super::TELEMETRY_ENABLED.store(enable, Ordering::Relaxed);
        if !initialized {
            super::init_telemetry(&app_handle).await;
        }
    }
}
