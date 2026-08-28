/// Starts the sidecar and says what the attempt did. On the scheduled task path `Started` means
/// the task was asked to run, which is not the same as the sidecar running.
pub(super) async fn start_sidecar() -> StartOutcome {
    let mut sidecar_manager_guard = super::SIDECAR_MANAGER.lock().await;
    let Some(sidecar_manager) = sidecar_manager_guard.as_mut() else {
        return StartOutcome::Failed;
    };
    sidecar_manager.start().await
}

/// Returns whether a sidecar is on its way, which includes one that was already running.
#[tauri::command]
pub async fn start_elevated_sidecar() -> bool {
    start_sidecar().await.is_on_its_way()
}

use crate::utils::sidecar_manager::StartOutcome;

#[tauri::command]
pub async fn elevated_sidecar_started() -> bool {
    let mut sidecar_manager_guard = super::SIDECAR_MANAGER.lock().await;
    let sidecar_manager = sidecar_manager_guard.as_mut().unwrap();
    sidecar_manager.has_started().await
}

#[tauri::command]
pub async fn elevated_sidecar_get_grpc_web_port() -> Option<u32> {
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
pub async fn elevated_sidecar_get_grpc_port() -> Option<u32> {
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

/// The one call that can raise a UAC prompt. The result distinguishes a declined prompt from a
/// failure, which the UI reports differently.
#[tauri::command]
pub async fn elevated_features_enable() -> super::launcher::EnableResult {
    super::launcher::enable().await
}

#[tauri::command]
pub async fn elevated_features_disable() {
    // taken before the manager lock, the same order enable uses
    let _transition = super::TRANSITION.lock().await;
    super::request_stop().await;
    let mut manager_guard = super::SIDECAR_MANAGER.lock().await;
    if let Some(manager) = manager_guard.as_mut() {
        manager.stop_and_stay_stopped().await;
    }
}
