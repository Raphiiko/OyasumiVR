use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

#[derive(Serialize, Clone, Type, Event)]
pub struct SteamworksReadyEvent(pub bool);
