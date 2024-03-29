use crate::elevated_sidecar::SIDECAR_GRPC_CLIENT;
use crate::Models::elevated_sidecar::{
    SetMsiAfterburnerProfileError, SetMsiAfterburnerProfileRequest,
};
use log::error;

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn msi_afterburner_set_profile(
    executable_path: String,
    profile: u32,
) -> Result<bool, SetMsiAfterburnerProfileError> {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = client_guard.as_mut().unwrap();
    let response = match client
        .set_msi_afterburner_profile(tonic::Request::new(SetMsiAfterburnerProfileRequest {
            executable_path,
            profile,
        }))
        .await
    {
        Ok(response) => response.into_inner(),
        Err(e) => {
            error!(
                "[Core] Could not apply a new MSI Afterburner profile: {}",
                e
            );
            return Err(SetMsiAfterburnerProfileError::UnknownError);
        }
    };
    if response.success {
        Ok(true)
    } else {
        error!(
            "[Core] Could not apply a new MSI Afterburner profile: {:?}",
            response.error
        );
        match response.error {
            None => Err(SetMsiAfterburnerProfileError::UnknownError),
            Some(e) => Err(SetMsiAfterburnerProfileError::try_from(e).unwrap()),
        }
    }
}
