use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "UPPERCASE")]
pub enum OpenVRStatus {
    Inactive,
    Initializing,
    Initialized,
}