use serde::Serialize;

use super::audio_devices::device::AudioDeviceDto;
use crate::utils::event;

#[derive(Serialize, Clone, specta::Type)]
pub struct VrchatProcessActiveEvent(pub bool);
event!(VrchatProcessActiveEvent, "VRCHAT_PROCESS_ACTIVE");

#[derive(Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MicLevelReport {
    pub device_id: String,
    pub level: f32,
    pub active: bool,
}
event!(MicLevelReport, "mic_level");

#[derive(Serialize, Clone, specta::Type)]
pub struct AudioDeviceUpdatedEvent(pub AudioDeviceDto);
event!(AudioDeviceUpdatedEvent, "audioDeviceUpdated");

#[derive(Serialize, Clone, specta::Type)]
pub struct AudioDevicesUpdatedEvent(pub Vec<AudioDeviceDto>);
event!(AudioDevicesUpdatedEvent, "audioDevicesUpdated");
