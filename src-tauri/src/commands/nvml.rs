use crate::elevated_sidecar;
use oyasumi_shared::models::{
    NVMLDevice, NVMLSetPowerManagementLimitRequest, NVMLSetPowerManagementLimitResponse,
};

#[tauri::command]
pub async fn nvml_status() -> String {
    let url = match elevated_sidecar::get_base_url() {
        Some(base_url) => base_url + "/nvml/status",
        None => return "ELEVATED_SIDECAR_INACTIVE".into(),
    };
    let resp = reqwest::get(url).await;
    match resp {
        Ok(resp) => resp.text().await.unwrap(),
        Err(_) => "ELEVATED_SIDECAR_INACTIVE".into(),
    }
}

#[tauri::command]
pub async fn nvml_get_devices() -> Vec<NVMLDevice> {
    let url = match elevated_sidecar::get_base_url() {
        Some(base_url) => base_url + "/nvml/get_devices",
        None => return Vec::new(),
    };
    let resp = reqwest::get(url).await;
    let body = match resp {
        Ok(resp) => resp.text().await.unwrap(),
        Err(_) => return Vec::new(),
    };
    serde_json::from_str::<Vec<NVMLDevice>>(&body).unwrap()
}

#[tauri::command]
pub async fn nvml_set_power_management_limit(uuid: String, limit: u32) -> Result<bool, String> {
    let url = match elevated_sidecar::get_base_url() {
        Some(base_url) => base_url + "/nvml/set_power_management_limit",
        None => return Err("ELEVATED_SIDECAR_INACTIVE".into()),
    };
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .body(serde_json::to_string(&NVMLSetPowerManagementLimitRequest { uuid, limit }).unwrap())
        .send()
        .await;
    let body = match resp {
        Ok(resp) => resp.text().await.unwrap(),
        Err(_) => return Err("UNKNOWN_ERROR".into()),
    };
    let response: NVMLSetPowerManagementLimitResponse = serde_json::from_str(&body).unwrap();
    if response.success {
        Ok(true)
    } else {
        Err(response.error.unwrap())
    }
}
