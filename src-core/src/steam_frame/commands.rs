use std::time::Duration;

use super::{
    connection, devkit, discovery, hex,
    models::{
        Access, Candidate, CleanupOutcome, CleanupRequest, OtherPcsOutcome, Pairing, PairingKeys,
        ProbeOutcome, RegisterOutcome, SetBrightnessError, SetupRequest, SetupResult, StageEvent,
        State, SupportedModel,
    },
    setup,
    ssh::{self, SshError},
    valid_pc_id, SUPPORTED_MODELS,
};
use crate::utils::send_event;

#[tauri::command]
pub fn steam_frame_get_supported_models() -> Vec<SupportedModel> {
    SUPPORTED_MODELS.to_vec()
}

/// One candidate per headset: addresses that show the same SSH host key are one headset.
#[tauri::command]
pub async fn steam_frame_discover_headsets() -> Vec<Candidate> {
    let candidates = discovery::discover(Duration::from_secs(3)).await;
    let pins = futures::future::join_all(
        candidates
            .iter()
            .map(|candidate| ssh::host_key_pin(&candidate.address)),
    )
    .await;
    distinct_headsets(candidates, pins)
}

/// Keeps the first candidate per host key; a candidate without a key stays on its own.
fn distinct_headsets(candidates: Vec<Candidate>, pins: Vec<Option<String>>) -> Vec<Candidate> {
    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .zip(pins)
        .filter(|(_, pin)| pin.as_ref().is_none_or(|pin| seen.insert(pin.clone())))
        .map(|(candidate, _)| candidate)
        .collect()
}

/// `None` when no devkit service answers at the address.
#[tauri::command]
pub async fn steam_frame_get_ssh_user(address: String) -> Option<String> {
    devkit::login_name(address.trim()).await
}

#[tauri::command]
pub async fn steam_frame_create_pairing_keys() -> Result<PairingKeys, String> {
    // name the key after this PC
    let computer = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".into());
    let credentials = tokio::task::spawn_blocking(move || {
        ssh::create_credentials(&format!("OyasumiVR@{computer}"))
    })
    .await
    .map_err(|e| e.to_string())??;

    // add a random token for the helper
    Ok(PairingKeys {
        private_key: credentials.private_key,
        public_key: credentials.public_key,
        token: hex(&rand::random::<[u8; 32]>()),
    })
}

#[tauri::command]
pub async fn steam_frame_request_approval(address: String, public_key: String) -> RegisterOutcome {
    devkit::register(&address, &public_key).await
}

/// Tries this PC's saved key, and reports the host key a first login would pin.
#[tauri::command]
pub async fn steam_frame_check_ssh_access(
    access: Access,
    pc_id: String,
    public_key: String,
) -> ProbeOutcome {
    if !valid_pc_id(&pc_id) {
        return ProbeOutcome::Failed {
            message: "invalid PC id".into(),
        };
    }
    match setup::open(&access, &pc_id, &public_key).await {
        Ok(session) => {
            let host_key_pin = session.host_key_pin.clone();
            session.close().await;
            ProbeOutcome::Ok { host_key_pin }
        }
        Err(SshError::Rejected) => ProbeOutcome::Rejected,
        Err(SshError::Unreachable) => ProbeOutcome::Unreachable,
        Err(SshError::HostKeyChanged) => ProbeOutcome::HostKeyChanged,
        Err(SshError::Failed(message)) => ProbeOutcome::Failed { message },
    }
}

#[tauri::command]
pub async fn steam_frame_set_up_helper(request: SetupRequest) -> SetupResult {
    let attempt_id = request.attempt_id.clone();
    setup::setup(request, move |stage| {
        let event = StageEvent {
            attempt_id: attempt_id.clone(),
            stage,
        };
        tokio::spawn(send_event("STEAM_FRAME_SETUP_STAGE", event));
    })
    .await
}

#[tauri::command]
pub async fn steam_frame_remove_access(request: CleanupRequest) -> CleanupOutcome {
    setup::cleanup(request).await
}

#[tauri::command]
pub async fn steam_frame_count_other_pcs(
    access: Access,
    pc_id: String,
    public_key: String,
) -> OtherPcsOutcome {
    setup::count_other_pcs(&access, &pc_id, &public_key).await
}

#[tauri::command]
pub async fn steam_frame_sync_connections(pairings: Vec<Pairing>) {
    connection::set_pairings(pairings).await
}

/// Starts a helper update. The result arrives as connection state events.
#[tauri::command]
pub async fn steam_frame_update_helper(pairing_id: String) -> bool {
    connection::request_update(&pairing_id).await
}

#[tauri::command]
pub async fn steam_frame_get_connection_states() -> Vec<State> {
    connection::states().await
}

/// Sets the paired headset's hardware brightness and returns the percentage the helper applied.
#[tauri::command]
pub async fn steam_frame_set_brightness(
    pairing_id: String,
    percentage: f64,
) -> Result<f64, SetBrightnessError> {
    connection::set_brightness(&pairing_id, percentage).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(address: &str) -> Candidate {
        Candidate {
            name: "Steam Frame".into(),
            address: address.into(),
        }
    }

    #[test]
    fn distinct_headsets_merges_addresses_with_one_host_key() {
        let candidates = [
            "10.35.78.1",
            "192.168.1.115",
            "192.168.1.120",
            "192.168.1.130",
        ]
        .map(candidate)
        .to_vec();
        let pins = vec![Some("A".into()), Some("A".into()), Some("B".into()), None];
        let addresses: Vec<String> = distinct_headsets(candidates, pins)
            .into_iter()
            .map(|c| c.address)
            .collect();
        assert_eq!(addresses, ["10.35.78.1", "192.168.1.120", "192.168.1.130"]);
    }
}
