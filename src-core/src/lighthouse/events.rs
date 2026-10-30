use serde::Serialize;

use super::models::{LighthouseDeviceModel, LighthousePowerState, LighthouseStatus};
use crate::utils::event;

#[derive(Debug, Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseScanningStatusChangedEvent {
    pub scanning: bool,
}
event!(
    LighthouseScanningStatusChangedEvent,
    "LIGHTHOUSE_SCANNING_STATUS_CHANGED"
);

#[derive(Debug, Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseStatusChangedEvent {
    pub status: LighthouseStatus,
}
event!(LighthouseStatusChangedEvent, "LIGHTHOUSE_STATUS_CHANGED");

#[derive(Debug, Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseDeviceDiscoveredEvent {
    pub device: LighthouseDeviceModel,
}
event!(
    LighthouseDeviceDiscoveredEvent,
    "LIGHTHOUSE_DEVICE_DISCOVERED"
);

#[derive(Debug, Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseDevicePowerStateChangedEvent {
    pub device_id: String,
    pub power_state: LighthousePowerState,
    pub v1_timeout: Option<u16>,
}
event!(
    LighthouseDevicePowerStateChangedEvent,
    "LIGHTHOUSE_DEVICE_POWER_STATE_CHANGED"
);

#[derive(Serialize, Clone, specta::Type)]
pub struct LighthouseConnectsFailingEvent;
event!(
    LighthouseConnectsFailingEvent,
    "LIGHTHOUSE_CONNECTS_FAILING"
);

#[derive(Serialize, Clone, specta::Type)]
pub struct LighthouseConnectsRecoveredEvent;
event!(
    LighthouseConnectsRecoveredEvent,
    "LIGHTHOUSE_CONNECTS_RECOVERED"
);
