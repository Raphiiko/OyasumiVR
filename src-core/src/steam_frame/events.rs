use serde::Serialize;

use super::models::{Control, FadeOutcome, Stage, State};
use crate::utils::event;

/// The helper ended a fade.
#[derive(Serialize, Clone, Debug, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FadeEnded {
    pub pairing_id: String,
    pub control: Control,
    pub operation: String,
    pub outcome: FadeOutcome,
}
event!(FadeEnded, "STEAM_FRAME_FADE_ENDED");

#[derive(Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StageEvent {
    pub attempt_id: String,
    pub stage: Stage,
}
event!(StageEvent, "STEAM_FRAME_SETUP_STAGE");

#[derive(Serialize, Clone, specta::Type)]
pub struct SteamFrameConnectionStateEvent(pub State);
event!(
    SteamFrameConnectionStateEvent,
    "STEAM_FRAME_CONNECTION_STATE"
);
