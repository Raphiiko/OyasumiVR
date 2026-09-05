use crate::Models::{NvmlDevice, NvmlSetPowerManagementLimitError, NvmlStatus};
use log::info;
use std::sync::Mutex;

mod adlx;
mod nvml;

lazy_static! {
    static ref GPU_POWER_STATUS: Mutex<NvmlStatus> = Mutex::new(NvmlStatus::Initializing);
}

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

pub fn status() -> NvmlStatus {
    *GPU_POWER_STATUS.lock().unwrap()
}

pub fn get_devices() -> Vec<NvmlDevice> {
    let mut devices = nvml::get_devices();
    devices.extend(adlx::get_devices());
    devices
}

pub fn set_power_management_limit(
    uuid: String,
    limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    if adlx::owns_device(&uuid) {
        return adlx::set_power_management_limit(uuid, limit);
    }

    nvml::set_power_management_limit(uuid, limit)
}
