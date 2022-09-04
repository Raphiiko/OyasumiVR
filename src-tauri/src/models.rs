use openvr::TrackedDeviceClass;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(remote = "TrackedDeviceClass")]
pub enum TrackedDeviceClassDef {
    Invalid,
    HMD,
    Controller,
    GenericTracker,
    TrackingReference,
    DisplayRedirect,
}

#[derive(Clone, serde::Serialize)]
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
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NVMLDevice {
    pub index: u32,
    pub name: String,
    pub power_limit: Option<u32>,
    pub min_power_limit: Option<u32>,
    pub max_power_limit: Option<u32>,
    pub default_power_limit: Option<u32>,
}

#[derive(Clone, serde::Serialize)]
pub struct DeviceUpdateEvent {
    pub device: OVRDevice,
}

#[derive(serde::Serialize)]

pub struct Output {
    pub stdout: String,
    pub stderr: String,
    pub status: i32,
}
