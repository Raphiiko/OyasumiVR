pub mod commands;
mod connection;
mod devkit;
mod discovery;
mod models;
mod setup;
mod ssh;
mod wss;

use models::SupportedModel;

/// The helper protocol version this build speaks. A helper accepts a range of versions.
pub const PROTOCOL_VERSION: u32 = 1;
pub const HELPER_PORT: u16 = 38440;
pub const HELPER_PATH: &str = "resources/frame-helper/oyasumivr-frame-helper";
/// The one place that decides which headsets offer pairing, matched exactly.
pub const SUPPORTED_MODELS: &[SupportedModel] = &[SupportedModel {
    manufacturer: "Valve",
    model: "Deckard DV2",
}];

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
