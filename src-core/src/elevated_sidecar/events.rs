use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

/// Carries the sidecar's gRPC-web port.
#[derive(Serialize, Clone, Type, Event)]
pub struct ElevatedSidecarStartedEvent(pub u32);

#[derive(Serialize, Clone, Type, Event)]
pub struct ElevatedSidecarStoppedEvent;

#[derive(Serialize, Clone, Type, Event)]
pub struct ElevationPromptShownEvent;
