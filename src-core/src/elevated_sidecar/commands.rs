#[tauri::command]
pub async fn start_elevated_sidecar() {
    let mut sidecar_manager_guard = super::SIDECAR_MANAGER.lock().await;
    let sidecar_manager = sidecar_manager_guard.as_mut().unwrap();
    sidecar_manager.start(false).await;
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
            match grpc_web_port.as_ref() {
                Some(grpc_web_port) => Some(*grpc_web_port),
                None => None,
            }
        }
        None => None,
    }
}
