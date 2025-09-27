use adb_client::DeviceState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "status", content = "message")]
pub enum ADBServerStatus {
    NotFound(String),
    UnknownError(String),
    Running,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ADBDeviceState {
    Offline,
    Device,
    NoDevice,
    Authorizing,
    Unauthorized,
    Connecting,
    NoPerm,
    Detached,
    Bootloader,
    Host,
    Recovery,
    Sideload,
    Rescue,
}

impl From<DeviceState> for ADBDeviceState {
    fn from(state: DeviceState) -> Self {
        match state {
            DeviceState::Offline => ADBDeviceState::Offline,
            DeviceState::Device => ADBDeviceState::Device,
            DeviceState::NoDevice => ADBDeviceState::NoDevice,
            DeviceState::Authorizing => ADBDeviceState::Authorizing,
            DeviceState::Unauthorized => ADBDeviceState::Unauthorized,
            DeviceState::Connecting => ADBDeviceState::Connecting,
            DeviceState::NoPerm => ADBDeviceState::NoPerm,
            DeviceState::Detached => ADBDeviceState::Detached,
            DeviceState::Bootloader => ADBDeviceState::Bootloader,
            DeviceState::Host => ADBDeviceState::Host,
            DeviceState::Recovery => ADBDeviceState::Recovery,
            DeviceState::Sideload => ADBDeviceState::Sideload,
            DeviceState::Rescue => ADBDeviceState::Rescue,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ADBDevice {
    pub identifier: String,
    pub state: ADBDeviceState,
    pub usb: String,
    pub product: String,
    pub model: String,
    pub device: String,
    pub transport_id: u32,
}

impl From<adb_client::DeviceLong> for ADBDevice {
    fn from(device: adb_client::DeviceLong) -> Self {
        ADBDevice {
            identifier: device.identifier,
            state: device.state.into(),
            usb: device.usb,
            product: device.product,
            model: device.model,
            device: device.device,
            transport_id: device.transport_id,
        }
    }
}

