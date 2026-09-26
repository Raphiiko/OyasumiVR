use serde::{Deserialize, Serialize};

use super::SUPPORTED_MODELS;

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

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Candidate {
    pub name: String,
    pub address: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RegisterOutcome {
    Registered,
    Declined,
    Timeout,
    NotReady,
    Unreachable,
    /// The request may have reached the headset, but no answer came back.
    Lost,
    Failed,
}

/// A completed pairing, as the UI stores it.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    pub id: String,
    pub access: Access,
    pub port: u16,
    pub cert_pin: String,
    pub token: String,
    pub public_key: String,
    pub identity: Identity,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Connecting,
    Connected,
    Offline,
    IdentityChanged,
    NeedsAppUpdate,
    HelperOutdated,
    HostKeyChanged,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub pairing_id: String,
    pub status: Status,
    /// Milliseconds since the epoch of the last authenticated contact in this session.
    pub last_seen: Option<u64>,
    pub helper_version: Option<String>,
    /// The address and certificate this PC now trusts, which may differ from the stored ones.
    pub address: String,
    pub cert_pin: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SetupRequest {
    pub attempt_id: String,
    pub access: Access,
    pub pc_id: String,
    pub token: String,
    pub public_key: String,
    pub identity: Identity,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Verify,
    Install,
    /// This attempt installed the helper. Not a visible step.
    Installed,
    Connection,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SetupOutcome {
    #[serde(rename_all = "camelCase")]
    Complete {
        cert_pin: String,
        port: u16,
        helper_version: String,
    },
    WrongDevice,
    IdentityMissing,
    #[serde(rename_all = "camelCase")]
    NeedsAppUpdate {
        helper_version: String,
    },
    HelperBusy,
    HostKeyChanged,
    Rejected,
    Unreachable,
    Failed {
        message: String,
    },
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SetupResult {
    #[serde(flatten)]
    pub outcome: SetupOutcome,
    /// Whether this call installed the helper, so a cancelled pairing knows to remove it.
    pub installed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRequest {
    pub access: Access,
    pub pc_id: String,
    pub public_key: String,
    pub remove_helper: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CleanupOutcome {
    Done,
    Unreachable,
    HostKeyChanged,
    HelperBusy,
    Failed { message: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingKeys {
    pub private_key: String,
    pub public_key: String,
    pub token: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ProbeOutcome {
    #[serde(rename_all = "camelCase")]
    Ok {
        host_key_pin: String,
    },
    Rejected,
    Unreachable,
    HostKeyChanged,
    Failed {
        message: String,
    },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StageEvent {
    pub attempt_id: String,
    pub stage: Stage,
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
