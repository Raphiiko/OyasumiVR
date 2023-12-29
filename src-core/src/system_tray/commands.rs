use super::{SystemTrayManager, SYSTEMTRAY_MANAGER};

#[tauri::command]
#[oyasumivr_macros::command_profiling_async]
pub async fn set_close_to_system_tray(enabled: bool) {
    let mut manager_guard = SYSTEMTRAY_MANAGER.lock().await;
    let manager: &mut SystemTrayManager = manager_guard.as_mut().unwrap();
    manager.close_to_tray = enabled;
}

#[tauri::command]
#[oyasumivr_macros::command_profiling_async]
pub async fn set_start_in_system_tray(enabled: bool) {
    let mut manager_guard = SYSTEMTRAY_MANAGER.lock().await;
    let manager: &mut SystemTrayManager = manager_guard.as_mut().unwrap();
    manager.start_in_tray = enabled;
}
