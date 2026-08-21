#[tauri::command]
pub async fn start_elevated_sidecar() {
    let mut sidecar_manager_guard = super::SIDECAR_MANAGER.lock().await;
    let sidecar_manager = sidecar_manager_guard.as_mut().unwrap();
    sidecar_manager.start().await;
}

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

#[tauri::command]
pub async fn privileged_launcher_state() -> super::launcher::LauncherState {
    super::launcher::state()
}

/// The one call that can raise a UAC prompt. The result distinguishes a declined prompt from a
/// failure, which the UI reports differently.
#[tauri::command]
pub async fn elevated_features_enable() -> super::launcher::EnableResult {
    super::launcher::enable().await
}

#[tauri::command]
pub async fn elevated_features_disable() {
    super::request_stop().await;
    let mut manager_guard = super::SIDECAR_MANAGER.lock().await;
    if let Some(manager) = manager_guard.as_mut() {
        manager.stop_and_stay_stopped().await;
    }
}
