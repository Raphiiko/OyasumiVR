pub mod commands;

use std::time::Duration;

use crate::globals::{OVERLAY_SIDECAR_GRPC_DEV_PORT, OVERLAY_SIDECAR_GRPC_WEB_DEV_PORT};
use crate::utils::models::OverlaySidecarMode;
use crate::utils::sidecar_manager::SidecarManager;
use crate::{
    utils::send_event,
    Models::overlay_sidecar::oyasumi_overlay_sidecar_client::OyasumiOverlaySidecarClient,
    Models::oyasumi_core::OverlaySidecarStartArgs,
};
use log::info;
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
        "resources/overlay-sidecar/".to_string(),
        "overlay-sidecar.exe".to_string(),
        tx,
    ));
    // Listen for sidecar stop signals
    tokio::spawn(async move {
        while let Some(_) = rx.recv().await {
            *SIDECAR_GRPC_CLIENT.lock().await = None;
            send_event("OVERLAY_SIDECAR_STOPPED", ()).await;
        }
    });
    match crate::utils::cli_sidecar_overlay_mode().await {
        // In release mode, start the sidecar
        OverlaySidecarMode::Release => {
            let mut manager_guard = SIDECAR_MANAGER.lock().await;
            let manager = manager_guard.as_mut().unwrap();
            manager.start().await;
        }
        // In development mode, we expect the sidecar to be started in development mode manually
        OverlaySidecarMode::Dev => {
            let _ = handle_overlay_sidecar_start(&OverlaySidecarStartArgs {
                pid: 0,
                grpc_port: OVERLAY_SIDECAR_GRPC_DEV_PORT as u32,
                grpc_web_port: OVERLAY_SIDECAR_GRPC_WEB_DEV_PORT as u32,
            })
            .await;
        }
    }
}

pub async fn add_notification(message: String, duration: Duration) -> Result<String, String> {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = match client_guard.as_mut() {
        Some(client) => client,
        None => return Err("Sidecar is not running".to_string()),
    };
    let message = crate::Models::overlay_sidecar::AddNotificationRequest {
        message,
        duration: duration.as_millis() as u32,
    };
    let notification_id = client.add_notification(tonic::Request::new(message)).await;
    match notification_id {
        Ok(response) => match response.into_inner().notification_id.clone() {
            Some(notification_id) => Ok(notification_id),
            None => Err("Failed to add notification".to_string()),
        },
        Err(e) => Err(e.to_string()),
    }
}

pub async fn clear_notification(notification_id: String) {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = match client_guard.as_mut() {
        Some(client) => client,
        None => return,
    };
    let _ = client
        .clear_notification(tonic::Request::new(
            crate::Models::overlay_sidecar::ClearNotificationRequest { notification_id },
        ))
        .await;
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
            crate::Models::overlay_sidecar::Empty {},
        ))
        .await;
}

pub async fn handle_overlay_sidecar_start(
    args: &OverlaySidecarStartArgs,
) -> Result<(), Box<dyn std::error::Error>> {
    let manager_guard = SIDECAR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    // Ignore this signal if it is invalid
    if !manager
        .handle_start_signal(args.grpc_port, args.grpc_web_port, args.pid, None)
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
