pub mod commands;
mod connection;
mod devkit;
mod discovery;
mod setup;
mod ssh;
mod wss;

use serde::{Deserialize, Serialize};

/// The helper protocol version this build speaks. A helper accepts a range of versions.
pub const PROTOCOL_VERSION: u32 = 1;
pub const HELPER_PORT: u16 = 38440;
pub const HELPER_PATH: &str = "resources/frame-helper/oyasumivr-frame-helper";
/// The one place that decides which headsets offer pairing, matched exactly.
pub const SUPPORTED_MODELS: &[SupportedModel] = &[SupportedModel {
    manufacturer: "Valve",
    model: "Deckard DV2",
}];

#[derive(Serialize, Clone, Copy)]
pub struct SupportedModel {
    pub manufacturer: &'static str,
    pub model: &'static str,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub serial: String,
    pub model: String,
    pub manufacturer: String,
}

impl Identity {
    pub fn is_supported(&self) -> bool {
        SUPPORTED_MODELS
            .iter()
            .any(|m| m.manufacturer == self.manufacturer && m.model == self.model)
    }
}

/// How this PC reaches a headset over SSH. A missing pin trusts the first host key it sees.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    pub address: String,
    pub user: String,
    pub private_key: String,
    pub host_key_pin: Option<String>,
}

/// A PC names its token file on the headset, so the name must stay a single safe path segment.
pub fn valid_pc_id(pc_id: &str) -> bool {
    (1..=64).contains(&pc_id.len())
        && pc_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(manufacturer: &str, model: &str) -> Identity {
        Identity {
            serial: "FPTEST000001".into(),
            model: model.into(),
            manufacturer: manufacturer.into(),
        }
    }

    #[test]
    fn allowlist_matches_exactly() {
        assert!(identity("Valve", "Deckard DV2").is_supported());
        for (manufacturer, model) in [
            ("Valve", "Deckard"),
            ("Valve", "deckard dv2"),
            ("Valve", "Deckard DV2 "),
            ("valve", "Deckard DV2"),
            ("Valve", "Index"),
            ("Bigscreen", "Beyond"),
        ] {
            assert!(!identity(manufacturer, model).is_supported(), "{model}");
        }
    }
}
