use serde::Serialize;

use crate::utils::event;
use crate::Models::oyasumi_core::AddNotificationRequest;

/// A notification the overlay sidecar asks the UI to show.
#[derive(Serialize, Clone, specta::Type)]
pub struct AddNotificationEvent(pub AddNotificationRequest);
event!(AddNotificationEvent, "addNotification");
