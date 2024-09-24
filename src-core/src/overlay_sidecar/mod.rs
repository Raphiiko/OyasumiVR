pub mod commands;

use crate::utils::sidecar_manager::SidecarManager;
use crate::Models::overlay_sidecar::MicrophoneActivityMode;
use crate::{
    utils::send_event,
    Models::overlay_sidecar::oyasumi_overlay_sidecar_client::OyasumiOverlaySidecarClient,
    Models::oyasumi_core::OverlaySidecarStartArgs,
};
use tokio::sync::Mutex;
use tonic::transport::Channel;

lazy_static! {
    pub static ref SIDECAR_GRPC_CLIENT: Mutex<Option<OyasumiOverlaySidecarClient<Channel>>> =
        Default::default();
    static ref SIDECAR_MANAGER: Mutex<Option<SidecarManager>> = Default::default();
}

pub async fn init() {
    let (tx, mut rx) = tokio::sync::mpsc::channel(10);
    *SIDECAR_MANAGER.lock().await = Some(SidecarManager::new(
        "OVERLAY".to_string(),
        "resources/dotnet-sidecars/".to_string(),
        "oyasumivr-overlay-sidecar.exe".to_string(),
        tx,
        true,
        vec![],
    ));
    // Listen for sidecar stop signals
    tokio::spawn(async move {
        while let Some(_) = rx.recv().await {
            *SIDECAR_GRPC_CLIENT.lock().await = None;
            send_event("OVERLAY_SIDECAR_STOPPED", ()).await;
        }
    });
}

pub async fn handle_overlay_sidecar_start(
    args: &OverlaySidecarStartArgs,
) -> Result<(), Box<dyn std::error::Error>> {
    let manager_guard = SIDECAR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    // Ignore this signal if it is invalid
    if !manager
        .handle_start_signal(
            Some(args.grpc_port),
            Some(args.grpc_web_port),
            args.pid,
            None,
        )
        .await
    {
        return Ok(());
    }
    // Create new GRPC client
    let grpc_client =
        OyasumiOverlaySidecarClient::connect(format!("http://127.0.0.1:{}", args.grpc_port))
            .await?;
    *SIDECAR_GRPC_CLIENT.lock().await = Some(grpc_client);
    send_event("OVERLAY_SIDECAR_STARTED", args.grpc_web_port).await;
    Ok(())
}

pub async fn set_microphone_active(active: bool, mode: MicrophoneActivityMode) {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = match client_guard.as_mut() {
        Some(client) => client,
        None => return,
    };
    let _ = client
        .set_microphone_active(tonic::Request::new(
            crate::Models::overlay_sidecar::SetMicrophoneActiveRequest {
                active,
                mode: mode as i32,
            },
        ))
        .await;
}
