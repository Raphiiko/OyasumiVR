use crate::Models::{NvmlDevice, NvmlSetPowerManagementLimitError, NvmlStatus};
use log::{error, info};
use nvml_wrapper::Nvml;
use std::sync::Mutex;

lazy_static! {
    static ref NVML_HANDLE: Mutex<Option<Nvml>> = Default::default();
}

/// An absolute path to `nvml.dll` in the Windows system directory, as Windows reports it.
fn nvml_path() -> Option<std::path::PathBuf> {
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;

    // A short buffer is answered with the length needed, so this asks at most twice.
    let mut buffer = vec![0u16; 260];
    let mut written =
        unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if written > buffer.len() {
        buffer = vec![0u16; written];
        written = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    }
    if written == 0 || written > buffer.len() {
        return None;
    }
    Some(std::path::PathBuf::from(String::from_utf16_lossy(&buffer[..written])).join("nvml.dll"))
}

pub fn init() -> Result<(), NvmlStatus> {
    let Some(path) = nvml_path() else {
        error!("[NVML] Could not determine the system directory");
        *NVML_HANDLE.lock().unwrap() = None;
        return Err(NvmlStatus::LibLoadingError);
    };
    info!("[NVML] Initializing NVML from {}", path.display());
    match Nvml::builder().lib_path(path.as_os_str()).init() {
        Ok(nvml) => {
            info!("[NVML] Successfully initialized NVML");
            *NVML_HANDLE.lock().unwrap() = Some(nvml);
            Ok(())
        }
        Err(err) => {
            *NVML_HANDLE.lock().unwrap() = None;
            error!("[NVML] Could not initialize NVML: {}", err);
            Err(match err {
                nvml_wrapper::error::NvmlError::DriverNotLoaded => NvmlStatus::DriverNotLoaded,
                nvml_wrapper::error::NvmlError::LibloadingError(_) => NvmlStatus::LibLoadingError,
                nvml_wrapper::error::NvmlError::NoPermission => NvmlStatus::NoPermission,
                _ => NvmlStatus::NvmlUnknownError,
            })
        }
    }
}

pub fn get_devices() -> Vec<NvmlDevice> {
    let mut gpus: Vec<NvmlDevice> = Vec::new();

    if let Some(nvml) = NVML_HANDLE.lock().unwrap().as_ref() {
        let count = nvml.device_count().unwrap_or(0);
        for n in 0..count {
            let device = match nvml.device_by_index(n) {
                Ok(device) => device,
                Err(err) => {
                    error!(
                        "[NVML] Could not access GPU at index {} due to an error: {:#?}",
                        n, err
                    );
                    continue;
                }
            };
            let constraints = device.power_management_limit_constraints().ok();
            gpus.push(NvmlDevice {
                uuid: device.uuid().unwrap_or_else(|_| format!("nvml:{n}")),
                name: device.name().unwrap_or_else(|_| format!("NVIDIA GPU {n}")),
                power_limit: device.power_management_limit().unwrap_or(0),
                min_power_limit: constraints.as_ref().map(|c| c.min_limit).unwrap_or(0),
                max_power_limit: constraints.as_ref().map(|c| c.max_limit).unwrap_or(0),
                default_power_limit: device.power_management_limit_default().unwrap_or(0),
            });
        }
    }

    gpus
}

pub fn set_power_management_limit(
    uuid: String,
    limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    let nvml_guard = NVML_HANDLE.lock().unwrap();
    let nvml = match nvml_guard.as_ref() {
        Some(nvml) => nvml,
        None => return Err(NvmlSetPowerManagementLimitError::DeviceAccessError),
    };

    let mut device = match nvml.device_by_uuid(uuid.clone()) {
        Ok(device) => device,
        Err(err) => {
            // Fallback for synthetic IDs generated when UUID lookup fails.
            let fallback_index = uuid
                .strip_prefix("nvml:")
                .and_then(|index| index.parse::<u32>().ok());
            match fallback_index.and_then(|index| nvml.device_by_index(index).ok()) {
                Some(device) => device,
                None => {
                    error!(
                        "[NVML] Could not access GPU (uuid:{:#?}) due to an error: {:#?}",
                        uuid, err
                    );
                    return Err(NvmlSetPowerManagementLimitError::DeviceAccessError);
                }
            }
        }
    };

    if let Err(err) = device.set_power_management_limit(limit) {
        error!(
            "[NVML] Could not set power limit for GPU (uuid:{:#?}) due to an error: {:#?}",
            uuid, err
        );
        return Err(NvmlSetPowerManagementLimitError::DeviceSetPowerLimitError);
    }

    Ok(true)
}
