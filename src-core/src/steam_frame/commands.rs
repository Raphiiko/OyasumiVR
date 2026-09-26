use std::time::Duration;

use serde::Serialize;

use super::{
    connection::{self, Pairing, State},
    devkit::{self, RegisterOutcome},
    discovery::{self, Candidate},
    hex,
    setup::{self, CleanupOutcome, CleanupRequest, SetupRequest, SetupResult, Stage},
    ssh::{self, SshError},
    Access, SupportedModel, SUPPORTED_MODELS,
};
use crate::utils::send_event;

#[tauri::command]
pub fn steam_frame_get_supported_models() -> Vec<SupportedModel> {
    SUPPORTED_MODELS.to_vec()
}

#[tauri::command]
pub async fn steam_frame_discover_headsets() -> Vec<Candidate> {
    discovery::discover(Duration::from_secs(3)).await
}

/// `None` when no devkit service answers at the address.
#[tauri::command]
pub async fn steam_frame_get_ssh_user(address: String) -> Option<String> {
    devkit::login_name(address.trim()).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    private_key: String,
    public_key: String,
    token: String,
}

#[tauri::command]
pub async fn steam_frame_create_pairing_keys() -> Result<Credentials, String> {
    let computer = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".into());
    let credentials = tokio::task::spawn_blocking(move || {
        ssh::create_credentials(&format!("OyasumiVR@{computer}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Credentials {
        private_key: credentials.private_key,
        public_key: credentials.public_key,
        token: hex(&rand::random::<[u8; 32]>()),
    })
}

#[tauri::command]
pub async fn steam_frame_request_approval(address: String, public_key: String) -> RegisterOutcome {
    devkit::register(&address, &public_key).await
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

/// Tries this PC's saved key, and reports the host key a first login would pin.
#[tauri::command]
pub async fn steam_frame_check_ssh_access(access: Access) -> ProbeOutcome {
    match ssh::connect(&access).await {
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StageEvent {
    attempt_id: String,
    stage: Stage,
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
pub async fn steam_frame_sync_connections(pairings: Vec<Pairing>) {
    connection::set_pairings(pairings).await
}

#[tauri::command]
pub async fn steam_frame_get_connection_states() -> Vec<State> {
    connection::states().await
}
