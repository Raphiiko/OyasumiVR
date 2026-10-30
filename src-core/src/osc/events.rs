use serde::{Deserialize, Serialize};

use super::models::OSCValue;
use crate::utils::event;

#[derive(Serialize, Clone, specta::Type)]
pub struct VrcOscAddressChangedEvent(pub Option<String>);
event!(VrcOscAddressChangedEvent, "VRC_OSC_ADDRESS_CHANGED");

#[derive(Serialize, Clone, specta::Type)]
pub struct VrcOscQueryAddressChangedEvent(pub Option<String>);
event!(
    VrcOscQueryAddressChangedEvent,
    "VRC_OSCQUERY_ADDRESS_CHANGED"
);

#[derive(Clone, Serialize, Deserialize, Debug, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OSCMessage {
    pub address: String,
    pub values: Vec<OSCValue>,
}
event!(OSCMessage, "OSC_MESSAGE");
