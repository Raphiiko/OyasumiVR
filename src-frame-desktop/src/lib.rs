pub mod connection;
pub mod controller;
pub mod discovery;
pub mod identity;
pub mod lifecycle;
pub mod onboarding;
pub mod provision;
pub mod ssh;
pub mod storage;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Error {
    InvalidInput,
    SetupIncomplete,
    MaintenanceBackoff,
    ArtifactUnavailable,
    DiscoveryUnavailable,
    Persistence,
    UnsupportedPlatform,
    Offline,
    HostKeyChanged,
    AuthenticationFailed,
    CompanionAuthenticationFailed,
    NotArmed,
    Denied,
    Timeout,
    Busy,
    RegistrationUncertain,
    Cancelled,
    IdentityUnverified,
    RemoteOperation,
    CertificateChanged,
    WrongDevice,
    ProtocolMismatch,
}

pub type Result<T> = std::result::Result<T, Error>;

pub use oyasumivr_frame_protocol as protocol;
