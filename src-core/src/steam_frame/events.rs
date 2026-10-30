use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

use super::models::{FadeEnded, Stage, State};

#[derive(Serialize, Clone, Type, Event)]
pub struct SteamFrameFadeEndedEvent(pub FadeEnded);

#[derive(Serialize, Clone, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SteamFrameSetupStageEvent {
    pub attempt_id: String,
    pub stage: Stage,
}

#[derive(Serialize, Clone, Type, Event)]
pub struct SteamFrameConnectionStateEvent(pub State);
