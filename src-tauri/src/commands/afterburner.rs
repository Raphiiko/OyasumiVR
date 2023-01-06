use crate::elevated_sidecar;
use log::{error, info};
use oyasumi_shared::models::{MSIAfterburnerSetProfileRequest, MSIAfterburnerSetProfileResponse};

#[tauri::command]
pub async fn msi_afterburner_set_profile(
    executable_path: String,
    profile: i8,
) -> Result<bool, String> {
    let url = match elevated_sidecar::get_base_url() {
        Some(base_url) => base_url + "/msi_afterburner/set_profile",
        None => return Err("ELEVATED_SIDECAR_INACTIVE".into()),
    };
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .body(
            serde_json::to_string(&MSIAfterburnerSetProfileRequest {
                executable_path,
                profile,
            })
            .unwrap(),
        )
        .send()
        .await;
    let body = match resp {
        Ok(resp) => resp.text().await.unwrap(),
        Err(_) => return Err("UNKNOWN_ERROR".into()),
    };
    let response: MSIAfterburnerSetProfileResponse = serde_json::from_str(&body).unwrap();
    if response.success {
        Ok(true)
    } else {
        error!(
            "[Core] Could not set MSI Afterburner profile: {:?}",
            response.error
        );
        let mut error = response.error.unwrap();
        if error.starts_with("EXE_SIGNATURE_DISALLOWED") {
            error = String::from("EXE_SIGNATURE_DISALLOWED");
        }
        Err(error)
    }
}
