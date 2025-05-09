use crate::elevated_sidecar::SIDECAR_GRPC_CLIENT;
use crate::Models::elevated_sidecar::{
    Empty, NvmlDevice, NvmlPowerManagementLimitRequest, NvmlSetPowerManagementLimitError,
    NvmlStatus,
};
use log::error;

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn nvml_status() -> NvmlStatus {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = client_guard.as_mut();
    if client.is_none() {
        return NvmlStatus::SidecarUnavailable;
    }
    let client = client.unwrap();
    let response = match client.get_nvml_status(tonic::Request::new(Empty {})).await {
        Ok(response) => response.into_inner(),
        Err(e) => {
            error!("[Core] Could not get the current NVML status: {}", e);
            return NvmlStatus::SidecarUnavailable;
        }
    };
    return NvmlStatus::try_from(response.status).unwrap();
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn nvml_get_devices() -> Vec<NvmlDevice> {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = client_guard.as_mut().unwrap();
    match client.get_nvml_devices(tonic::Request::new(Empty {})).await {
        Ok(response) => response.into_inner().devices,
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn nvml_set_power_management_limit(
    uuid: String,
    power_limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = client_guard.as_mut().unwrap();
    let response = match client
        .set_nvml_power_management_limit(tonic::Request::new(NvmlPowerManagementLimitRequest {
            uuid,
            power_limit,
        }))
        .await
    {
        Ok(response) => response.into_inner(),
        Err(e) => {
            error!(
                "[Core] Could not set the NVML power management limit: {}",
                e
            );
            return Err(NvmlSetPowerManagementLimitError::UnknownError);
        }
    };
    if response.success {
        Ok(true)
    } else {
        error!(
            "[Core] Could not set NVML power management limit: {:?}",
            response.error
        );
        match response.error {
            None => Err(NvmlSetPowerManagementLimitError::UnknownError),
            Some(e) => Err(NvmlSetPowerManagementLimitError::try_from(e).unwrap()),
        }
    }
}
