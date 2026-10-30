use serde::Serialize;

use super::{DebugSnapshot, SleepingPose};
use crate::utils::event;

#[derive(Serialize, Clone, specta::Type)]
pub struct SleepingPoseUpdateEvent(pub SleepingPose);
event!(SleepingPoseUpdateEvent, "SLEEPING_POSE_UPDATE");

#[derive(Serialize, Clone, specta::Type)]
pub struct SleepingPoseDebugEvent(pub DebugSnapshot);
event!(SleepingPoseDebugEvent, "SLEEPING_POSE_DEBUG");
