#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn get_core_grpc_port() -> Option<u32> {
    let port_guard = super::SERVER_PORT.lock().await;
    port_guard.as_ref().copied()
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn get_core_grpc_web_port() -> Option<u32> {
    let port_guard = super::SERVER_WEB_PORT.lock().await;
    port_guard.as_ref().copied()
}
