use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OSCValue {
    pub kind: String,
    pub value: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OSCMessage {
    pub address: String,
    pub values: Vec<OSCValue>,
}
