use serde::{Deserialize, Serialize};

pub const MAX_MESSAGE_BYTES: usize = 8192;
pub const PROTOCOL: Protocol = Protocol { major: 1, minor: 1 };

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Protocol {
    pub major: u16,
    pub minor: u16,
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
