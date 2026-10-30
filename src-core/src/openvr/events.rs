use serde::{Deserialize, Serialize};

use super::models::{OVRDevice, OpenVRStatus};
use crate::utils::event;

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenVRInputEvent {
    pub action: String,
    pub pressed: bool,
    pub time_ago: f32,
    pub device: Option<OVRDevice>,
}
event!(OpenVRInputEvent, "OVR_INPUT_EVENT_DIGITAL");

#[derive(Serialize, Clone, specta::Type)]
pub struct OvrStatusUpdateEvent(pub OpenVRStatus);
event!(OvrStatusUpdateEvent, "OVR_STATUS_UPDATE");

#[derive(Clone, Serialize, Deserialize, specta::Type)]
pub struct DeviceUpdateEvent {
    pub device: OVRDevice,
}
event!(DeviceUpdateEvent, "OVR_DEVICE_UPDATE");

#[derive(Clone, Serialize, Deserialize, specta::Type)]
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
event!(SleepDetectorStateReport, "SLEEP_DETECTOR_STATE_REPORT");

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GestureDetected {
    pub gesture: String,
}
event!(GestureDetected, "GESTURE_DETECTED");

#[derive(Serialize, Clone, specta::Type)]
pub struct OvrAnalogGainUpdateEvent(pub f32);
event!(OvrAnalogGainUpdateEvent, "OVR_ANALOG_GAIN_UPDATE");
