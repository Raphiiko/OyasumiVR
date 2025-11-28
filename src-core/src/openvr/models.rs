use openvr::input::{VRActionHandle,VRActionSetHandle};
use serde::{Deserialize, Serialize};
use strum_macros::{EnumIter, IntoStaticStr};

pub struct OpenVRAction {
    pub name: String,
    pub handle: VRActionHandle,
}

pub struct OpenVRActionSet {
    pub name: String,
    pub handle: VRActionSetHandle,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingOriginData {
    pub localized_controller_type: String,
    pub localized_hand: String,
    pub localized_input_source: String,
    pub device_path_name: String,
    pub input_path_name: String,
    pub mode_name: String,
    pub slot_name: String,
    pub input_source_type: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenVRInputEvent {
    pub action: String,
    pub pressed: bool,
    pub time_ago: f32,
    pub device: Option<OVRDevice>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "UPPERCASE")]
pub enum OpenVRStatus {
    Inactive,
    Initializing,
    Initialized,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub enum TrackedControllerRole {
    Invalid,
    LeftHand,
    RightHand,
    OptOut,
    Treadmill,
    Stylus,
}

impl From<openvr::TrackedControllerRole> for TrackedControllerRole {
    fn from(item: openvr::TrackedControllerRole) -> Self {
        match item {
            openvr::TrackedControllerRole::Invalid => {
                TrackedControllerRole::Invalid
            }
            openvr::TrackedControllerRole::LeftHand => {
                TrackedControllerRole::LeftHand
            }
            openvr::TrackedControllerRole::RightHand => {
                TrackedControllerRole::RightHand
            }
            openvr::TrackedControllerRole::OptOut => {
                TrackedControllerRole::OptOut
            }
            openvr::TrackedControllerRole::Treadmill => {
                TrackedControllerRole::Treadmill
            }
            openvr::TrackedControllerRole::Stylus => {
                TrackedControllerRole::Stylus
            }
        }
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[allow(clippy::upper_case_acronyms)]
pub enum TrackedDeviceClass {
    Invalid,
    HMD,
    Controller,
    GenericTracker,
    TrackingReference,
    DisplayRedirect,
}

impl From<openvr::TrackedDeviceClass> for TrackedDeviceClass {
    fn from(item: openvr::TrackedDeviceClass) -> Self {
        match item {
            openvr::TrackedDeviceClass::Invalid => {
                TrackedDeviceClass::Invalid
            }
            openvr::TrackedDeviceClass::HMD => {
                TrackedDeviceClass::HMD
            }
            openvr::TrackedDeviceClass::Controller => {
                TrackedDeviceClass::Controller
            }
            openvr::TrackedDeviceClass::GenericTracker => {
                TrackedDeviceClass::GenericTracker
            }
            openvr::TrackedDeviceClass::TrackingReference => {
                TrackedDeviceClass::TrackingReference
            }
            openvr::TrackedDeviceClass::DisplayRedirect => {
                TrackedDeviceClass::DisplayRedirect
            }
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OVRDevice {
    pub index: u32,
    pub class: TrackedDeviceClass,
    pub role: TrackedControllerRole,
    pub battery: Option<f32>,
    pub provides_battery_status: Option<bool>,
    pub can_power_off: Option<bool>,
    pub is_charging: Option<bool>,
    pub dongle_id: Option<String>,
    pub serial_number: Option<String>,
    pub hardware_revision: Option<String>,
    pub manufacturer_name: Option<String>,
    pub model_number: Option<String>,
    pub handle_type: Option<OVRHandleType>,
    pub hmd_on_head: Option<bool>,
    pub hmd_activity: Option<String>,
    pub display_frequency: Option<f32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OVRDevicePose {
    pub index: u32,
    pub quaternion: [f64; 4],
    pub position: [f32; 3],
}

#[derive(Clone, Serialize, Deserialize, IntoStaticStr, EnumIter)]
pub enum OVRHandleType {
    HandPrimary,
    HandSecondary,
    Head,
    Gamepad,
    Treadmill,
    Stylus,
    FootLeft,
    FootRight,
    ShoulderLeft,
    ShoulderRight,
    ElbowLeft,
    ElbowRight,
    KneeLeft,
    KneeRight,
    WristLeft,
    WristRight,
    AnkleLeft,
    AnkleRight,
    Waist,
    Chest,
    Camera,
    Keyboard,
}

impl OVRHandleType {
    pub fn as_action_handle(&self) -> &str {
        match self {
            OVRHandleType::HandPrimary => "/user/hand/primary",
            OVRHandleType::HandSecondary => "/user/hand/secondary",
            OVRHandleType::Head => "/user/head",
            OVRHandleType::Gamepad => "/user/gamepad",
            OVRHandleType::Treadmill => "/user/treadmill",
            OVRHandleType::Stylus => "/user/stylus",
            OVRHandleType::FootLeft => "/user/foot/left",
            OVRHandleType::FootRight => "/user/foot/right",
            OVRHandleType::ShoulderLeft => "/user/shoulder/left",
            OVRHandleType::ShoulderRight => "/user/shoulder/right",
            OVRHandleType::ElbowLeft => "/user/elbow/left",
            OVRHandleType::ElbowRight => "/user/elbow/right",
            OVRHandleType::KneeLeft => "/user/knee/left",
            OVRHandleType::KneeRight => "/user/knee/right",
            OVRHandleType::WristLeft => "/user/wrist/left",
            OVRHandleType::WristRight => "/user/wrist/right",
            OVRHandleType::AnkleLeft => "/user/ankle/left",
            OVRHandleType::AnkleRight => "/user/ankle/right",
            OVRHandleType::Waist => "/user/waist",
            OVRHandleType::Chest => "/user/chest",
            OVRHandleType::Camera => "/user/camera",
            OVRHandleType::Keyboard => "/user/keyboard",
        }
    }
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OVRFrameLimits {
    pub additional_frames_to_predict: u8,
    pub frames_to_throttle: u8,
}
