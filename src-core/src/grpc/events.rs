use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

use crate::Models::oyasumi_core::AddNotificationRequest;

/// A notification the overlay sidecar asks the UI to show.
#[derive(Serialize, Clone, Type, Event)]
pub struct AddNotificationEvent(pub AddNotificationRequest);
