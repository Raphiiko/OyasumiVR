use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

use super::models::{LighthouseDeviceModel, LighthousePowerState, LighthouseStatus};

#[derive(Serialize, Clone, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseScanningStatusChangedEvent {
    pub scanning: bool,
}

#[derive(Serialize, Clone, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseStatusChangedEvent {
    pub status: LighthouseStatus,
}

#[derive(Serialize, Clone, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseDeviceDiscoveredEvent {
    pub device: LighthouseDeviceModel,
}

#[derive(Serialize, Clone, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct LighthouseDevicePowerStateChangedEvent {
    pub device_id: String,
    pub power_state: LighthousePowerState,
    pub v1_timeout: Option<u16>,
}

#[derive(Serialize, Clone, Type, Event)]
pub struct LighthouseConnectsFailingEvent;

#[derive(Serialize, Clone, Type, Event)]
pub struct LighthouseConnectsRecoveredEvent;
