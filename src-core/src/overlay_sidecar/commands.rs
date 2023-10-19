use crate::{
    globals::{OVERLAY_SIDECAR_GRPC_DEV_PORT, OVERLAY_SIDECAR_GRPC_WEB_DEV_PORT},
    utils::models::OverlaySidecarMode,
    Models::oyasumi_core::OverlaySidecarStartArgs,
};
use std::time::Duration;

#[tauri::command]
pub async fn start_overlay_sidecar(gpu_fix: bool) {
    match crate::utils::cli_sidecar_overlay_mode().await {
        // In release mode, start the sidecar like normal
        OverlaySidecarMode::Release => {
            let mut sidecar_manager_guard = super::SIDECAR_MANAGER.lock().await;
            let sidecar_manager = sidecar_manager_guard.as_mut().unwrap();
            sidecar_manager.set_arg("--gpu-fix", gpu_fix, true).await;
            sidecar_manager.start_or_restart().await;
        }
        // In development mode, we expect the sidecar to be started in development mode manually
        OverlaySidecarMode::Dev => {
            let _ = super::handle_overlay_sidecar_start(&OverlaySidecarStartArgs {
                pid: 0,
                grpc_port: OVERLAY_SIDECAR_GRPC_DEV_PORT as u32,
                grpc_web_port: OVERLAY_SIDECAR_GRPC_WEB_DEV_PORT as u32,
            })
            .await;
        }
    }
}

#[tauri::command]
pub async fn add_notification(message: String, duration: u64) -> Result<String, String> {
    super::add_notification(message, Duration::from_millis(duration)).await
}

#[tauri::command]
pub async fn clear_notification(notification_id: String) {
    super::clear_notification(notification_id).await;
}

#[tauri::command]
pub async fn overlay_sidecar_get_grpc_web_port() -> Option<u32> {
    let manager_guard = super::SIDECAR_MANAGER.lock().await;
    let manager = manager_guard.as_ref();
    match manager {
        Some(manager) => {
            let grpc_web_port = manager.grpc_web_port.lock().await;
            match grpc_web_port.as_ref() {
                Some(grpc_web_port) => Some(*grpc_web_port),
                None => None,
            }
        }
        None => None,
    }
}
