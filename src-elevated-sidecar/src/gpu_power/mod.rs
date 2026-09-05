use crate::Models::{NvmlDevice, NvmlSetPowerManagementLimitError, NvmlStatus};
use log::info;
use std::sync::Mutex;

mod adlx;
mod nvml;

lazy_static! {
    static ref GPU_POWER_STATUS: Mutex<NvmlStatus> = Mutex::new(NvmlStatus::Initializing);
}

/// Probes both backends and succeeds if either initializes, even with no supported devices.
/// If both fail, publishes the NVML initialization error as the shared status.
pub fn init() -> bool {
    info!("[GPU] Initializing power-limit backends (NVML + ADLX)");

    let mut fallback_status = NvmlStatus::NvmlUnknownError;
    let nvml_initialized = match nvml::init() {
        Ok(()) => true,
        Err(status) => {
            fallback_status = status;
            false
        }
    };

    let adlx_initialized = adlx::init();
    let initialized = nvml_initialized || adlx_initialized;

    *GPU_POWER_STATUS.lock().unwrap() = if initialized {
        NvmlStatus::InitComplete
    } else {
        fallback_status
    };

    initialized
}

/// Returns cached combined readiness, which remains `Initializing` until `init` completes.
pub fn status() -> NvmlStatus {
    *GPU_POWER_STATUS.lock().unwrap()
}

/// Combines NVIDIA driver readings and AMD cached readings; unavailable backends add no devices.
pub fn get_devices() -> Vec<NvmlDevice> {
    let mut devices = nvml::get_devices();
    devices.extend(adlx::get_devices());
    devices
}

/// Routes `adlx:` IDs to AMD with `(percent_offset + 100) * 1000`; other IDs use NVIDIA milliwatts.
pub fn set_power_management_limit(
    uuid: String,
    limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    if adlx::owns_device(&uuid) {
        return adlx::set_power_management_limit(uuid, limit);
    }

    nvml::set_power_management_limit(uuid, limit)
}
