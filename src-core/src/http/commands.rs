#[tauri::command]
pub async fn get_http_server_port() -> Option<u32> {
    let port_guard = super::PORT.lock().await;
    port_guard.as_ref().copied()
}
