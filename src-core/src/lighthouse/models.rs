use bluest::{Device, DeviceId};
use serde::{ser::SerializeStruct, Deserialize, Serialize, Serializer};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub enum LighthouseStatus {
    Uninitialized,
    NoAdapter,
    AdapterError,
    Ready,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LighthousePowerState {
    Unknown,
    Sleep,
    Standby,
    Booting,
    On,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LighthouseDeviceType {
    LighthouseV1, // V1 Base Station (HTC)
    LighthouseV2, // V2 Base Station (Valve)
}

#[derive(Debug)]
pub enum LighthouseError {
    DeviceNotFound,
    FailedToGetServices(bluest::Error),
    ServiceNotFound,
    FailedToGetCharacteristics(bluest::Error),
    CharacteristicNotFound,
    FailedToReadCharacteristic(bluest::Error),
    FailedToWriteCharacteristic(bluest::Error),
    InvalidCharacteristicValue,
    CharacteristicDoesNotSupportRead,
    FailedToGetCharacteristicProperties(bluest::Error),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedLighthouseError {
    error: String,
    message: Option<String>,
}

impl Serialize for LighthouseError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut error = serializer.serialize_struct("SerializedLighthouseError", 2)?;
        match self {
            LighthouseError::DeviceNotFound => {
                error.serialize_field("error", "DeviceNotFound")?;
                error.serialize_field("message", &None::<String>)?;
            }
            LighthouseError::FailedToGetServices(e) => {
                error.serialize_field("error", "FailedToGetServices")?;
                error.serialize_field("message", &Some(e.to_string()))?;
            }
            LighthouseError::ServiceNotFound => {
                error.serialize_field("error", "ServiceNotFound")?;
                error.serialize_field("message", &None::<String>)?;
            }
            LighthouseError::FailedToGetCharacteristics(e) => {
                error.serialize_field("error", "FailedToGetCharacteristics")?;
                error.serialize_field("message", &Some(e.to_string()))?;
            }
            LighthouseError::CharacteristicNotFound => {
                error.serialize_field("error", "CharacteristicNotFound")?;
                error.serialize_field("message", &None::<String>)?;
            }
            LighthouseError::FailedToReadCharacteristic(e) => {
                error.serialize_field("error", "FailedToReadCharacteristic")?;
                error.serialize_field("message", &Some(e.to_string()))?;
            }
            LighthouseError::FailedToWriteCharacteristic(e) => {
                error.serialize_field("error", "FailedToWriteCharacteristic")?;
                error.serialize_field("message", &Some(e.to_string()))?;
            }
            LighthouseError::InvalidCharacteristicValue => {
                error.serialize_field("error", "InvalidCharacteristicValue")?;
                error.serialize_field("message", &None::<String>)?;
            }
            LighthouseError::CharacteristicDoesNotSupportRead => {
                error.serialize_field("error", "CharacteristicCoesNotSupportRead")?;
                error.serialize_field("message", &None::<String>)?;
            }
            LighthouseError::FailedToGetCharacteristicProperties(e) => {
                error.serialize_field("error", "FailedToReadCharacteristicProperties")?;
                error.serialize_field("message", &Some(e.to_string()))?;
            }
        };
        error.end()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseDeviceModel {
    pub id: String,
    pub device_name: String,
    pub power_state: LighthousePowerState,
    pub device_type: LighthouseDeviceType,
    pub v1_timeout: Option<u16>,
}

#[derive(Debug, Clone)]
pub struct LighthouseDevice {
    pub id: DeviceId,
    pub bt_device: Device,
    pub device_name: String,
    pub device_type: LighthouseDeviceType,
}

//
// Events
//
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseScanningStatusChangedEvent {
    pub scanning: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseStatusChangedEvent {
    pub status: LighthouseStatus,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseDeviceDiscoveredEvent {
    pub device: LighthouseDeviceModel,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseDevicePowerStateChangedEvent {
    pub device_id: String,
    pub power_state: LighthousePowerState,
    pub v1_timeout: Option<u16>,
}
