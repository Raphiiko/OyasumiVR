use crate::elevated_sidecar::SIDECAR_GRPC_CLIENT;
use crate::Models::elevated_sidecar::{
    Empty, NvmlDevice, NvmlPowerManagementLimitRequest, NvmlSetPowerManagementLimitError,
    NvmlStatus,
};
use log::error;

pub async fn status() -> NvmlStatus {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = match client_guard.as_mut() {
        Some(client) => client,
        None => return NvmlStatus::SidecarUnavailable,
    };
    let response = match client.get_nvml_status(tonic::Request::new(Empty {})).await {
        Ok(response) => response.into_inner(),
        Err(e) => {
            error!("[Core] Could not get the current GPU power backend status: {e}");
            return NvmlStatus::SidecarUnavailable;
        }
    };
    NvmlStatus::try_from(response.status).unwrap_or(NvmlStatus::UnknownError)
}

pub async fn get_devices() -> Vec<NvmlDevice> {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = match client_guard.as_mut() {
        Some(client) => client,
        None => return Vec::new(),
    };
    match client.get_nvml_devices(tonic::Request::new(Empty {})).await {
        Ok(response) => response.into_inner().devices,
        Err(_) => Vec::new(),
    }
}

pub async fn set_power_management_limit(
    uuid: String,
    power_limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = match client_guard.as_mut() {
        Some(client) => client,
        None => return Err(NvmlSetPowerManagementLimitError::SidecarUnavailable),
    };
    let response = match client
        .set_nvml_power_management_limit(tonic::Request::new(NvmlPowerManagementLimitRequest {
            uuid,
            power_limit,
        }))
        .await
    {
        Ok(response) => response.into_inner(),
        Err(e) => {
            error!("[Core] Could not set GPU power management limit: {e}");
            return Err(NvmlSetPowerManagementLimitError::UnknownError);
        }
    };
    if response.success {
        Ok(true)
    } else {
        error!(
            "[Core] Could not set GPU power management limit: {:?}",
            response.error
        );
        match response.error {
            None => Err(NvmlSetPowerManagementLimitError::UnknownError),
            Some(e) => Err(NvmlSetPowerManagementLimitError::try_from(e)
                .unwrap_or(NvmlSetPowerManagementLimitError::UnknownError)),
        }
    }
}
