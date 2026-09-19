use serde::{Deserialize, Serialize};

pub const MAX_MESSAGE_BYTES: usize = 8192;
pub const PROTOCOL: Protocol = Protocol { major: 1, minor: 1 };

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Protocol {
    pub major: u16,
    pub minor: u16,
}

/// Addresses and properties are unverified discovery hints.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DiscoveryCandidate {
    pub candidate_id: String,
    pub address: String,
    pub devkit_port: u16,
    pub hostname_hint: String,
    pub model_hint: String,
    pub source: DiscoverySource,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscoverySource {
    InjectedMdns,
    ExplicitAddress,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DiscoveryFixture {
    pub name: String,
    pub discovery_available: bool,
    pub selected_device_id: String,
    pub candidates: Vec<DiscoveryCandidate>,
    pub companion_device_id: String,
}

/// Pins and credential references survive connection loss; addresses can change.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PairingRecord {
    pub device_manager_id: String,
    pub verified_device_id: String,
    pub credential_ref: String,
    pub ssh_host_key_sha256: String,
    pub daemon_id: String,
    pub server_certificate_sha256: String,
    pub last_successful_contact: Option<String>,
    pub last_address: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ConnectionState {
    Offline,
    Connecting,
    Connected {
        build_version: String,
        steamvr: SteamVrState,
    },
    Failed {
        error: PairingError,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "step", rename_all = "snake_case")]
pub enum PairingProgress {
    Prepare,
    Discovering,
    AwaitingApproval,
    VerifyingSsh,
    VerifyingIdentity,
    SettingUpCompanion,
    VerifyingCompanion,
    Ready,
    Failed { error: PairingError },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PairingError {
    DiscoveryUnavailable,
    NotArmed,
    Denied,
    Timeout,
    InvalidKey,
    Busy,
    RegistrationUncertain,
    WrongDevice,
    AuthenticationFailed,
    ServerTrustMismatch,
    ProtocolMismatch,
    Offline,
    SetupIncomplete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SteamVrState {
    Ready,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Request {
    pub id: u64,
    #[serde(flatten)]
    pub command: Command,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    Hello {
        protocol: Protocol,
        expected_device_id: String,
        expected_daemon_id: String,
    },
    GetStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Reply {
    pub id: u64,
    #[serde(flatten)]
    pub result: ReplyResult,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReplyResult {
    Hello {
        protocol: Protocol,
        build_version: String,
        device_id: String,
        daemon_id: String,
        capabilities: Vec<String>,
        steamvr: SteamVrState,
    },
    Status {
        steamvr: SteamVrState,
    },
    Error {
        code: ProtocolError,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolError {
    HelloRequired,
    AlreadyInitialized,
    WrongIdentity,
    IncompatibleProtocol,
}
