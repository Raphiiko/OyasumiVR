use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
#[serde(rename_all = "UPPERCASE")]
pub enum OpenVRStatus {
    Inactive,
    Initializing,
    Initialized,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub enum TrackedDeviceClass {
    Invalid,
    HMD,
    Controller,
    GenericTracker,
    TrackingReference,
    DisplayRedirect,
}

impl From<ovr_overlay::sys::ETrackedDeviceClass> for TrackedDeviceClass {
    fn from(item: ovr_overlay::sys::ETrackedDeviceClass) -> Self {
        match item {
            ovr_overlay::sys::ETrackedDeviceClass::TrackedDeviceClass_Invalid => {
                TrackedDeviceClass::Invalid
            }
            ovr_overlay::sys::ETrackedDeviceClass::TrackedDeviceClass_HMD => {
                TrackedDeviceClass::HMD
            }
            ovr_overlay::sys::ETrackedDeviceClass::TrackedDeviceClass_Controller => {
                TrackedDeviceClass::Controller
            }
            ovr_overlay::sys::ETrackedDeviceClass::TrackedDeviceClass_GenericTracker => {
                TrackedDeviceClass::GenericTracker
            }
            ovr_overlay::sys::ETrackedDeviceClass::TrackedDeviceClass_TrackingReference => {
                TrackedDeviceClass::TrackingReference
            }
            ovr_overlay::sys::ETrackedDeviceClass::TrackedDeviceClass_DisplayRedirect => {
                TrackedDeviceClass::DisplayRedirect
            }
            _ => TrackedDeviceClass::Invalid,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OVRDevice {
    pub index: u32,
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepDetectorStateReport {
    pub distance_in_last_15_minutes: f64,
    pub distance_in_last_10_minutes: f64,
    pub distance_in_last_5_minutes: f64,
    pub distance_in_last_1_minute: f64,
    pub distance_in_last_10_seconds: f64,
    pub rotation_in_last_15_minutes: f64,
    pub rotation_in_last_10_minutes: f64,
    pub rotation_in_last_5_minutes: f64,
    pub rotation_in_last_1_minute: f64,
    pub rotation_in_last_10_seconds: f64,
    pub start_time: u128,
    pub last_log: u128,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GestureDetected {
    pub gesture: String,
}
