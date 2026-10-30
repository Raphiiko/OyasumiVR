use serde::Serialize;

use crate::utils::event;

/// Carries the sidecar's gRPC-web port.
#[derive(Serialize, Clone, specta::Type)]
pub struct ElevatedSidecarStartedEvent(pub u32);
event!(ElevatedSidecarStartedEvent, "ELEVATED_SIDECAR_STARTED");

#[derive(Serialize, Clone, specta::Type)]
pub struct ElevatedSidecarStoppedEvent;
event!(ElevatedSidecarStoppedEvent, "ELEVATED_SIDECAR_STOPPED");

#[derive(Serialize, Clone, specta::Type)]
pub struct ElevationPromptShownEvent;
event!(ElevationPromptShownEvent, "ELEVATION_PROMPT_SHOWN");
