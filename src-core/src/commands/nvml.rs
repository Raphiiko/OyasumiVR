use super::gpu_power;
use crate::Models::elevated_sidecar::{NvmlDevice, NvmlSetPowerManagementLimitError, NvmlStatus};

#[tauri::command]
pub async fn nvml_status() -> NvmlStatus {
    gpu_power::status().await
}

#[tauri::command]
pub async fn nvml_get_devices() -> Vec<NvmlDevice> {
    gpu_power::get_devices().await
}

#[tauri::command]
pub async fn nvml_set_power_management_limit(
    uuid: String,
    power_limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    gpu_power::set_power_management_limit(uuid, power_limit).await
}
