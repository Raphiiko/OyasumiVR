use std::time::Duration;

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
