#[tauri::command]
pub async fn elevation_sidecar_running() -> Option<u32> {
    super::active().await
}

#[tauri::command]
pub async fn start_elevation_sidecar() {
    super::start().await;
}
