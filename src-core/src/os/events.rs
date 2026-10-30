use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

use super::audio_devices::device::{AudioDeviceDto, MicLevelReport};

#[derive(Serialize, Clone, Type, Event)]
pub struct VrchatProcessActiveEvent(pub bool);

#[derive(Serialize, Clone, Type, Event)]
pub struct MicLevelEvent(pub MicLevelReport);

#[derive(Serialize, Clone, Type, Event)]
pub struct AudioDeviceUpdatedEvent(pub AudioDeviceDto);

#[derive(Serialize, Clone, Type, Event)]
pub struct AudioDevicesUpdatedEvent(pub Vec<AudioDeviceDto>);
