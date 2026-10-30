use serde::Serialize;

use crate::utils::event;

#[derive(Serialize, Clone, specta::Type)]
pub struct SteamworksReadyEvent(pub bool);
event!(SteamworksReadyEvent, "STEAMWORKS_READY");
