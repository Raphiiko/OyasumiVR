use super::gpu_power;
use crate::Models::elevated_sidecar::{NvmlDevice, NvmlSetPowerManagementLimitError, NvmlStatus};

/// Exposes combined NVML/ADLX readiness under the frontend's NVML command name.
#[tauri::command]
pub async fn nvml_status() -> NvmlStatus {
    gpu_power::status().await
}

/// Exposes both GPU backends; AMD IDs begin with `adlx:` and use encoded percentage limits.
#[tauri::command]
pub async fn nvml_get_devices() -> Vec<NvmlDevice> {
    gpu_power::get_devices().await
}

/// Accepts NVIDIA milliwatts or AMD `(percent_offset + 100) * 1000`, routed by device ID.
#[tauri::command]
pub async fn nvml_set_power_management_limit(
    uuid: String,
    power_limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    gpu_power::set_power_management_limit(uuid, power_limit).await
}
