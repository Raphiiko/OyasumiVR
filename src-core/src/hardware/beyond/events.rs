use serde::Serialize;

use crate::utils::event;

#[derive(Serialize, Clone, specta::Type)]
pub struct BigscreenBeyondConnectedEvent(pub bool);
event!(BigscreenBeyondConnectedEvent, "BIGSCREEN_BEYOND_CONNECTED");
