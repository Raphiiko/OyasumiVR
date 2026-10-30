use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

use super::models::{GestureDetected, OVRDevice, OpenVRStatus, SleepDetectorStateReport};

#[derive(Serialize, Clone, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct OpenVRInputEvent {
    pub action: String,
    pub pressed: bool,
    pub time_ago: f32,
    pub device: Option<OVRDevice>,
}

#[derive(Serialize, Clone, Type, Event)]
pub struct OvrStatusUpdateEvent(pub OpenVRStatus);

#[derive(Serialize, Clone, Type, Event)]
pub struct OvrDeviceUpdateEvent {
    pub device: OVRDevice,
}

#[derive(Serialize, Clone, Type, Event)]
pub struct SleepDetectorStateReportEvent(pub SleepDetectorStateReport);

#[derive(Serialize, Clone, Type, Event)]
pub struct GestureDetectedEvent(pub GestureDetected);

#[derive(Serialize, Clone, Type, Event)]
pub struct OvrAnalogGainUpdateEvent(pub f32);
