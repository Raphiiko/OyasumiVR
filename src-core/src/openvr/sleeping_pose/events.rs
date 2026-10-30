use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

use super::{DebugSnapshot, SleepingPose};

#[derive(Serialize, Clone, Type, Event)]
pub struct SleepingPoseUpdateEvent(pub SleepingPose);

#[derive(Serialize, Clone, Type, Event)]
pub struct SleepingPoseDebugEvent(pub DebugSnapshot);
