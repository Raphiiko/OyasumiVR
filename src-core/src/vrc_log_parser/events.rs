use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

#[derive(Clone, Serialize, Deserialize, Debug, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct VRCLogEvent {
    pub time: u64,
    pub event: String,
    pub data: String,
    pub initial_load: bool,
}

/// The VRChat log file the parser reads, if any.
#[derive(Serialize, Clone, Type, Event)]
pub struct VrcLogCurrentFileEvent(pub Option<String>);
