use crate::{NVML_HANDLE, models::NVMLDevice, NVML_STATUS};

#[tauri::command]
pub async fn nvml_status() -> String {
    NVML_STATUS.lock().unwrap().clone()
}

#[tauri::command]
pub async fn nvml_get_devices() -> Vec<NVMLDevice> {
    let nvml_guard = NVML_HANDLE.lock().unwrap();
    let nvml = nvml_guard.as_ref().unwrap();
    let count = nvml.device_count().unwrap();
    let mut gpus: Vec<NVMLDevice> = Vec::new();
    for n in 0..count {
        let device = match nvml.device_by_index(n) {
            Ok(device) => device,
            Err(err) => {
                println!(
                    "Could not access GPU at index {} due to an error: {:#?}",
                    n, err
                );
                continue;
            }
        };
        let constraints = device.power_management_limit_constraints().ok();
        gpus.push(NVMLDevice {
            uuid: device.uuid().unwrap(),
            name: device.name().unwrap(),
            power_limit: device.power_management_limit().ok(),
            min_power_limit: constraints.as_ref().and_then(|c| Some(c.min_limit)),
            max_power_limit: constraints.as_ref().and_then(|c| Some(c.max_limit)),
            default_power_limit: device.power_management_limit_default().ok(),
        });
    }
    gpus
}

#[tauri::command]
pub async fn nvml_set_power_management_limit(uuid: String, limit: u32) -> Result<bool, String> {
    let nvml_guard = NVML_HANDLE.lock().unwrap();
    let nvml = nvml_guard.as_ref().unwrap();

    let mut device = match nvml.device_by_uuid(uuid.clone()) {
        Ok(device) => device,
        Err(err) => {
            println!(
                "Could not access GPU (uuid:{:#?}) due to an error: {:#?}",
                uuid, err
            );
            return Err(String::from("DEVICE_ACCESS_ERROR"));
        }
    };

    match device.set_power_management_limit(limit) {
        Err(err) => {
            println!(
                "Could not set power limit for GPU (uuid:{:#?}) due to an error: {:#?}",
                uuid.clone(),
                err
            );
            return Err(String::from("DEVICE_SET_POWER_LIMIT_ERROR"));
        }
        _ => (),
    }

    Ok(true)
}