use crate::Models::{NvmlDevice, NvmlSetPowerManagementLimitError};
use log::{error, info, warn};
use std::sync::OnceLock;

mod device;
mod interface;
mod value;
mod worker;

use worker::Worker;

const DEVICE_ID_PREFIX: &str = "adlx:";

static WORKER: OnceLock<Result<Worker, String>> = OnceLock::new();

/// Initializes once; both the worker and any startup failure are cached for this process.
fn worker() -> Result<&'static Worker, String> {
    match WORKER.get_or_init(Worker::spawn) {
        Ok(worker) => Ok(worker),
        Err(err) => Err(err.clone()),
    }
}

/// Starts the ADLX worker and checks that it responds, even if no GPUs support power tuning.
pub(super) fn init() -> bool {
    info!("[ADLX] Probing ADLX backend");

    match worker().and_then(Worker::get_devices) {
        Ok(_) => {
            info!("[ADLX] ADLX backend is available");
            true
        }
        Err(err) => {
            warn!("[ADLX] ADLX backend unavailable: {err}");
            false
        }
    }
}

/// Checks the routing prefix only; the ID need not identify a discovered device.
pub(super) fn owns_device(uuid: &str) -> bool {
    uuid.starts_with(DEVICE_ID_PREFIX)
}

/// Returns cached device readings, or an empty list if worker startup or communication fails.
pub(super) fn get_devices() -> Vec<NvmlDevice> {
    match worker().and_then(Worker::get_devices) {
        Ok(devices) => devices,
        Err(err) => {
            error!("[ADLX] Could not query ADLX devices: {err}");
            Vec::new()
        }
    }
}

/// Blocks on applying `(percent_offset + 100) * 1000`; worker failure returns `DeviceAccessError`.
pub(super) fn set_power_management_limit(
    uuid: String,
    encoded_limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    let worker = worker().map_err(|err| {
        error!("[ADLX] Could not initialize ADLX while setting power limit: {err}");
        NvmlSetPowerManagementLimitError::DeviceAccessError
    })?;

    worker.set_power_limit(uuid, encoded_limit)
}

/// Namespaces an ADLX unique ID (or enumeration-index fallback) for backend routing.
fn device_id(unique_id: i32) -> String {
    format!("{DEVICE_ID_PREFIX}{unique_id}")
}

#[cfg(test)]
mod tests {
    use super::{device_id, owns_device};

    #[test]
    fn adlx_device_ids_route_to_adlx() {
        let id = device_id(42);
        assert_eq!(id, "adlx:42");
        assert!(owns_device(&id));
        assert!(!owns_device("GPU-123"));
    }

    #[test]
    #[ignore = "requires an AMD GPU and an installed ADLX driver"]
    fn driver_reports_supported_amd_power_limits() {
        use windows_sys::Win32::System::LibraryLoader::{
            SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_SYSTEM32,
        };

        assert_ne!(
            unsafe { SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32) },
            0
        );
        assert!(super::super::init());
        assert_eq!(
            super::super::status(),
            crate::Models::NvmlStatus::InitComplete
        );
        let devices: Vec<_> = super::super::get_devices()
            .into_iter()
            .filter(|device| owns_device(&device.uuid))
            .collect();
        assert!(
            !devices.is_empty(),
            "no AMD GPUs support manual power tuning"
        );
        for device in devices {
            assert!(owns_device(&device.uuid));
            assert!(device.min_power_limit < device.max_power_limit);
            assert!(device.default_power_limit >= device.min_power_limit);
            assert!(device.default_power_limit <= device.max_power_limit);
            println!(
                "{} ({}): current={}%, min={}%, max={}%, default={}%",
                device.name,
                device.uuid,
                super::value::decode_percent(device.power_limit),
                super::value::decode_percent(device.min_power_limit),
                super::value::decode_percent(device.max_power_limit),
                super::value::decode_percent(device.default_power_limit),
            );
        }
    }
}
