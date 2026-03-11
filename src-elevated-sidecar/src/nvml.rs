#![allow(dead_code)]

use crate::gpu_power;
use crate::Models::{NvmlDevice, NvmlSetPowerManagementLimitError, NvmlStatus};

// Compatibility shim for the existing RPC / Tauri command names.
pub fn init() -> bool {
    gpu_power::init()
}

pub async fn nvml_status() -> NvmlStatus {
    gpu_power::status().await
}

pub fn nvml_get_devices() -> Vec<NvmlDevice> {
    gpu_power::get_devices()
}

pub async fn nvml_set_power_management_limit(
    uuid: String,
    limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    gpu_power::set_power_management_limit(uuid, limit).await
}
