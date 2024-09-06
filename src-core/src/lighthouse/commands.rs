use std::time::Duration;

use super::models::{LighthouseDeviceModel, LighthouseError};

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn lighthouse_start_scan(duration: u64) {
    tokio::spawn(super::start_scan(Duration::from_secs(duration)));
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn lighthouse_get_devices() -> Vec<LighthouseDeviceModel> {
    super::get_devices().await
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn lighthouse_set_device_power_state(
    device_id: String,
    power_state: super::models::LighthousePowerState,
    v1_timeout: Option<u16>,
    v1_identifier: Option<u32>,
) -> Result<(), LighthouseError> {
    super::set_device_power_state(device_id, power_state, v1_timeout, v1_identifier).await
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn lighthouse_get_device_power_state(
    device_id: String,
) -> Result<(super::models::LighthousePowerState, Option<u16>), LighthouseError> {
    super::get_device_power_state(device_id).await
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn lighthouse_get_status() -> super::models::LighthouseStatus {
    super::STATUS.lock().await.clone()
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn lighthouse_get_scanning_status() -> bool {
    *super::SCANNING.lock().await
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn lighthouse_reset() {
    super::reset().await
}
