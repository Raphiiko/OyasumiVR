use serde::{Deserialize, Serialize};
use openvr::TrackedDeviceClass;

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

#[derive(Clone, Serialize, Deserialize)]
#[serde(remote = "TrackedDeviceClass")]
pub enum TrackedDeviceClassDef {
    Invalid,
    HMD,
    Controller,
    GenericTracker,
    TrackingReference,
    DisplayRedirect,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OVRDevice {
    pub index: u32,
    #[serde(with = "TrackedDeviceClassDef")]
    pub class: TrackedDeviceClass,
    pub battery: Option<f32>,
    pub provides_battery_status: Option<bool>,
    pub can_power_off: Option<bool>,
    pub is_charging: Option<bool>,
    pub dongle_id: Option<String>,
    pub serial_number: Option<String>,
    pub hardware_revision: Option<String>,
    pub manufacturer_name: Option<String>,
    pub model_number: Option<String>,
    // pub axis: Option<[i32; 5]>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OVRDevicePose {
    pub index: u32,
    pub quaternion: [f64; 4],
    pub position: [f32; 3],
}

// EVENTS

#[derive(Clone, Serialize, Deserialize)]
pub struct DeviceUpdateEvent {
    pub device: OVRDevice,
}
