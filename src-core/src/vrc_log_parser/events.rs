use serde::{Deserialize, Serialize};

use crate::utils::event;

#[derive(Clone, Serialize, Deserialize, Debug, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VRCLogEvent {
    pub time: u64,
    pub event: String,
    pub data: String,
    pub initial_load: bool,
}
event!(VRCLogEvent, "VRC_LOG_EVENT");

/// The VRChat log file the parser reads, if any.
#[derive(Serialize, Clone, specta::Type)]
pub struct VrcLogCurrentFileEvent(pub Option<String>);
event!(VrcLogCurrentFileEvent, "VRC_LOG_CURRENT_FILE");
