use serde::Serialize;

use crate::utils::event;

/// Carries the sidecar's gRPC-web port.
#[derive(Serialize, Clone, specta::Type)]
pub struct OverlaySidecarStartedEvent(pub u32);
event!(OverlaySidecarStartedEvent, "OVERLAY_SIDECAR_STARTED");

#[derive(Serialize, Clone, specta::Type)]
pub struct OverlaySidecarStoppedEvent;
event!(OverlaySidecarStoppedEvent, "OVERLAY_SIDECAR_STOPPED");
