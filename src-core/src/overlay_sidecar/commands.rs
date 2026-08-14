use crate::{
    globals::{OVERLAY_SIDECAR_GRPC_DEV_PORT, OVERLAY_SIDECAR_GRPC_WEB_DEV_PORT},
    utils::models::OverlaySidecarMode,
    Models::oyasumi_core::OverlaySidecarStartArgs,
};
use log::info;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

static DEV_SIDECAR_WATCHER_RUNNING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn start_overlay_sidecar(gpu_acceleration: bool) {
    match crate::utils::cli_sidecar_overlay_mode().await {
        // In release mode, start the sidecar like normal
        OverlaySidecarMode::Release => {
            let mut sidecar_manager_guard = super::SIDECAR_MANAGER.lock().await;
            let sidecar_manager = sidecar_manager_guard.as_mut().unwrap();
            sidecar_manager
                .set_arg("--disable-gpu-acceleration", !gpu_acceleration, true)
                .await;
            sidecar_manager.start_or_restart().await;
        }
        // In development mode, we expect the sidecar to be started in development mode manually,
        // which can happen at any point after the core comes up, so keep watching for it.
        OverlaySidecarMode::Dev => {
            if DEV_SIDECAR_WATCHER_RUNNING.swap(true, Ordering::SeqCst) {
                return;
            }
            tokio::spawn(async move {
                info!(
                    "[Core] Waiting for the OVERLAY sidecar to start on port {OVERLAY_SIDECAR_GRPC_DEV_PORT}"
                );
                loop {
                    // Only announce the sidecar once its GRPC port accepts connections, so we
                    // don't log a start we cannot follow up on.
                    let reachable =
                        tokio::net::TcpStream::connect(("127.0.0.1", OVERLAY_SIDECAR_GRPC_DEV_PORT))
                            .await
                            .is_ok();
                    if reachable
                        && super::handle_overlay_sidecar_start(&OverlaySidecarStartArgs {
                            pid: 0,
                            grpc_port: OVERLAY_SIDECAR_GRPC_DEV_PORT as u32,
                            grpc_web_port: OVERLAY_SIDECAR_GRPC_WEB_DEV_PORT as u32,
                        })
                        .await
                        .is_ok()
                    {
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
                DEV_SIDECAR_WATCHER_RUNNING.store(false, Ordering::SeqCst);
            });
        }
    }
}

#[tauri::command]
pub async fn overlay_sidecar_get_grpc_web_port() -> Option<u32> {
    let manager_guard = super::SIDECAR_MANAGER.lock().await;
    let manager = manager_guard.as_ref();
    match manager {
        Some(manager) => {
            let grpc_web_port = manager.grpc_web_port.lock().await;
            grpc_web_port.as_ref().map(|grpc_web_port| *grpc_web_port)
        }
        None => None,
    }
}

#[tauri::command]
pub async fn overlay_sidecar_get_grpc_port() -> Option<u32> {
    let manager_guard = super::SIDECAR_MANAGER.lock().await;
    let manager = manager_guard.as_ref();
    match manager {
        Some(manager) => {
            let grpc_port = manager.grpc_port.lock().await;
            grpc_port.as_ref().map(|grpc_port| *grpc_port)
        }
        None => None,
    }
}
