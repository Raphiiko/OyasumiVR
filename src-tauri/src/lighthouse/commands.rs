use std::time::Duration;

use super::models::{LighthouseDevice, LighthouseError};

#[tauri::command]
pub async fn lighthouse_start_scan(duration: u64) {
    tokio::spawn(super::start_scan(Duration::from_secs(duration)));
}

#[tauri::command]
pub async fn lighthouse_get_devices() -> Vec<LighthouseDevice> {
    super::get_devices().await
}

#[tauri::command]
pub async fn lighthouse_set_device_power_state(
    device_id: String,
    power_state: super::models::LighthousePowerState,
) -> Result<(), LighthouseError> {
    super::set_device_power_state(device_id, power_state).await
}

#[tauri::command]
pub async fn lighthouse_get_device_power_state(
    device_id: String,
) -> Result<super::models::LighthousePowerState, LighthouseError> {
    super::get_device_power_state(device_id).await
}

#[tauri::command]
pub async fn lighthouse_get_status() -> super::models::LighthouseStatus {
    super::STATUS.lock().await.clone()
}

#[tauri::command]
pub async fn lighthouse_get_scanning_status() -> bool {
    super::SCANNING.lock().await.clone()
}
