use serde::{Deserialize, Serialize};

// SIDECAR COMMUNICATION

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElevatedSidecarInitRequest {
    pub sidecar_port: u16,
    pub sidecar_pid: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NVMLSetPowerManagementLimitRequest {
    pub uuid: String,
    pub limit: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NVMLSetPowerManagementLimitResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MSIAfterburnerSetProfileRequest {
    pub executable_path: String,
    pub profile: i8,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MSIAfterburnerSetProfileResponse {
    pub success: bool,
    pub error: Option<String>,
}

// ENTITIES

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NVMLDevice {
    pub uuid: String,
    pub name: String,
    pub power_limit: Option<u32>,
    pub min_power_limit: Option<u32>,
    pub max_power_limit: Option<u32>,
    pub default_power_limit: Option<u32>,
}

