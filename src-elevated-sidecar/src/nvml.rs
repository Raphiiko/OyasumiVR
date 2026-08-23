use crate::Models::{NvmlDevice, NvmlSetPowerManagementLimitError, NvmlStatus};
use log::{error, info};
use nvml_wrapper::Nvml;
use std::sync::Mutex;

lazy_static! {
    static ref NVML_STATUS: Mutex<NvmlStatus> = Mutex::new(NvmlStatus::Initializing);
    static ref NVML_HANDLE: Mutex<Option<Nvml>> = Default::default();
}

/// An absolute path, because loading by name searches this executable's own directory first.
///
/// Asks Windows for the system directory rather than reading `%SystemRoot%`, which this process
/// inherits and therefore does not control.
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

pub fn init() -> bool {
    let Some(path) = nvml_path() else {
        error!("[NVML] Could not determine the system directory");
        *NVML_HANDLE.lock().unwrap() = None;
        *NVML_STATUS.lock().unwrap() = NvmlStatus::LibLoadingError;
        return false;
    };
    info!("[NVML] Initializing NVML from {}", path.display());
    match Nvml::builder().lib_path(path.as_os_str()).init() {
        Ok(nvml) => {
            info!("[NVML] Successfully initialized NVML");
            *NVML_HANDLE.lock().unwrap() = Some(nvml);
            *NVML_STATUS.lock().unwrap() = NvmlStatus::InitComplete;
            true
        }
        Err(err) => {
            *NVML_HANDLE.lock().unwrap() = None;
            error!("[NVML] Could not initialize NVML: {}", err);
            match err {
                nvml_wrapper::error::NvmlError::DriverNotLoaded => {
                    *NVML_STATUS.lock().unwrap() = NvmlStatus::DriverNotLoaded;
                }
                nvml_wrapper::error::NvmlError::LibloadingError(_) => {
                    *NVML_STATUS.lock().unwrap() = NvmlStatus::LibLoadingError;
                }
                nvml_wrapper::error::NvmlError::NoPermission => {
                    *NVML_STATUS.lock().unwrap() = NvmlStatus::NoPermission;
                }
                _ => {
                    *NVML_STATUS.lock().unwrap() = NvmlStatus::NvmlUnknownError;
                }
            };
            false
        }
    }
}

pub async fn nvml_status() -> NvmlStatus {
    *NVML_STATUS.lock().unwrap()
}

pub fn nvml_get_devices() -> Vec<NvmlDevice> {
    let nvml_guard = NVML_HANDLE.lock().unwrap();
    let nvml = nvml_guard.as_ref().unwrap();
    let count = nvml.device_count().unwrap();
    let mut gpus: Vec<NvmlDevice> = Vec::new();
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
            uuid: device.uuid().unwrap(),
            name: device.name().unwrap(),
            power_limit: device.power_management_limit().unwrap_or(0),
            min_power_limit: constraints.as_ref().map(|c| c.min_limit).unwrap_or(0),
            max_power_limit: constraints.as_ref().map(|c| c.max_limit).unwrap_or(0),
            default_power_limit: device.power_management_limit_default().unwrap_or(0),
        });
    }
    gpus
}

pub async fn nvml_set_power_management_limit(
    uuid: String,
    limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    let nvml_guard = NVML_HANDLE.lock().unwrap();
    let nvml = nvml_guard.as_ref().unwrap();

    let mut device = match nvml.device_by_uuid(uuid.clone()) {
        Ok(device) => device,
        Err(err) => {
            error!(
                "[NVML] Could not access GPU (uuid:{:#?}) due to an error: {:#?}",
                uuid, err
            );
            return Err(NvmlSetPowerManagementLimitError::DeviceAccessError);
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
