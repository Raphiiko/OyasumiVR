pub mod commands;

use crate::utils::sidecar_manager::SidecarManager;
use crate::{
    utils::send_event,
    Models::elevated_sidecar::oyasumi_elevated_sidecar_client::OyasumiElevatedSidecarClient,
    Models::oyasumi_core::ElevatedSidecarStartArgs,
};
use log::info;
use tokio::sync::Mutex;
use tonic::transport::Channel;

lazy_static! {
    pub static ref SIDECAR_GRPC_CLIENT: Mutex<Option<OyasumiElevatedSidecarClient<Channel>>> =
        Default::default();
    static ref SIDECAR_MANAGER: Mutex<Option<SidecarManager>> = Default::default();
}

pub async fn init() {
    let (tx, mut rx) = tokio::sync::mpsc::channel(10);
    *SIDECAR_MANAGER.lock().await = Some(SidecarManager::new(
        "ELEVATED".to_string(),
        "resources/elevated-sidecar/".to_string(),
        "oyasumivr-elevated-sidecar.exe".to_string(),
        tx,
    ));
    // Wait for sidecar stop signals
    tokio::spawn(async move {
        while let Some(_) = rx.recv().await {
            *SIDECAR_GRPC_CLIENT.lock().await = None;
            send_event("ELEVATED_SIDECAR_STOPPED", ()).await;
        }
    });
}

#[allow(dead_code)]
pub async fn request_stop() {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = match client_guard.as_mut() {
        Some(client) => client,
        None => return,
    };
    info!("[Core] Stopping current sidecar...");
    let _ = client
        .request_stop(tonic::Request::new(
            crate::Models::elevated_sidecar::Empty {},
        ))
        .await;
}

pub async fn handle_elevated_sidecar_start(
    args: &ElevatedSidecarStartArgs,
) -> Result<(), Box<dyn std::error::Error>> {
    let manager_guard = SIDECAR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    // Ignore this signal if it is invalid
    if !manager
        .handle_start_signal(args.grpc_port, args.grpc_web_port, args.pid, args.old_pid)
        .await
    {
        return Ok(());
    }
    // Create new GRPC client
    let grpc_client =
        OyasumiElevatedSidecarClient::connect(format!("http://127.0.0.1:{}", args.grpc_port))
            .await?;
    *SIDECAR_GRPC_CLIENT.lock().await = Some(grpc_client);
    send_event("ELEVATED_SIDECAR_STARTED", args.grpc_web_port).await;
    Ok(())
}
