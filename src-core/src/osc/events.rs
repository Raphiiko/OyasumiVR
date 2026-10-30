use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

use super::models::OSCMessage;

#[derive(Serialize, Clone, Type, Event)]
pub struct VrcOscAddressChangedEvent(pub Option<String>);

#[derive(Serialize, Clone, Type, Event)]
pub struct VrcOscQueryAddressChangedEvent(pub Option<String>);

#[derive(Serialize, Clone, Type, Event)]
pub struct OscMessageReceivedEvent(pub OSCMessage);
