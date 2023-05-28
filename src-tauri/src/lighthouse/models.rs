use bluest::DeviceId;
use serde::{ser::SerializeStruct, Deserialize, Serialize, Serializer};

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
pub enum LighthouseStatus {
    Uninitialized,
    NoAdapter,
    AdapterError,
    Ready,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
pub enum LighthousePowerState {
    Unknown,
    Sleep,
    Standby,
    Booting,
    On,
}

#[derive(Debug)]
pub enum LighthouseError {
    DeviceNotFound,
    FailedToGetServices(bluest::Error),
    ServiceNotFound,
    FailedToGetCharacteristics(bluest::Error),
    CharacteristicNotFound,
    FailedToReadCharacteristic(bluest::Error),
    InvalidCharacteristicValue,
}

#[derive(Debug, Serialize)]
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
            LighthouseError::InvalidCharacteristicValue => {
                error.serialize_field("error", "InvalidCharacteristicValue")?;
                error.serialize_field("message", &None::<String>)?;
            }
        };
        error.end()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LighthouseDevice {
    pub id: DeviceId,
    pub device_name: Option<String>,
    pub power_state: LighthousePowerState,
}

//
// Events
//
#[derive(Debug, Serialize, Clone)]
pub struct LighthouseDeviceDiscoveredEvent {
    pub device: LighthouseDevice,
}

#[derive(Debug, Serialize, Clone)]
pub struct LighthouseDevicePowerStateChangedEvent {
    pub device_id: DeviceId,
    pub power_state: LighthousePowerState,
}
