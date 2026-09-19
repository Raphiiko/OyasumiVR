use serde::{Deserialize, Serialize};

pub const MAX_MESSAGE_BYTES: usize = 8192;
pub const PROTOCOL: Protocol = Protocol { major: 1, minor: 2 };

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
    GetBrightness,
    SetBrightness {
        operation_id: String,
        percentage: f64,
    },
    TransitionBrightness {
        operation_id: String,
        percentage: f64,
        duration_ms: u64,
        simple: Option<SimpleCurve>,
    },
    CancelBrightness {
        operation_id: String,
    },
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
    Brightness {
        state: BrightnessState,
    },
    BrightnessError {
        code: BrightnessError,
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

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct GainBounds {
    pub min: f64,
    pub max: f64,
}

impl GainBounds {
    pub fn valid(self) -> bool {
        self.min.is_finite() && self.max.is_finite() && self.min > 0.0 && self.min < self.max
    }
    pub fn percentages(self) -> [f64; 2] {
        [gain_to_percentage(self.min), gain_to_percentage(self.max)]
    }
}

pub fn gain_to_percentage(gain: f64) -> f64 {
    if gain >= 1.0 {
        gain * 100.0
    } else {
        gain.powf(1.0 / 2.2) * 100.0
    }
}
pub fn percentage_to_gain(percentage: f64) -> f64 {
    if percentage >= 100.0 {
        percentage / 100.0
    } else {
        (percentage / 100.0).powf(2.2)
    }
}
pub fn ease(progress: f64) -> f64 {
    let t = progress.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct SimpleCurve {
    pub from: f64,
    pub to: f64,
}

pub fn simple_hardware(percentage: f64, bounds: GainBounds) -> f64 {
    let [min, max] = bounds.percentages();
    if percentage < min {
        min
    } else {
        min + (max - min) * (percentage - min) / (100.0 - min)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrightnessError {
    Unsupported,
    NotReady,
    InvalidTarget,
    InvalidDuration,
    StaleOperation,
    WriteFailed,
    ReadFailed,
    InvalidBounds,
    Busy,
    Offline,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrightnessPhase {
    Idle,
    Accepted,
    Running,
    Deferred,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BrightnessState {
    pub revision: u64,
    pub ready: bool,
    pub bounds: Option<GainBounds>,
    pub applied: Option<f64>,
    pub requested: Option<f64>,
    pub accepted: Option<f64>,
    pub operation_id: Option<String>,
    pub phase: BrightnessPhase,
    pub progress: f64,
    pub elapsed_ms: u64,
    pub error: Option<BrightnessError>,
}
impl Default for BrightnessState {
    fn default() -> Self {
        Self {
            revision: 0,
            ready: false,
            bounds: None,
            applied: None,
            requested: None,
            accepted: None,
            operation_id: None,
            phase: BrightnessPhase::Idle,
            progress: 0.0,
            elapsed_ms: 0,
            error: None,
        }
    }
}
