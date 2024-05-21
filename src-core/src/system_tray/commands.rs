use super::{SystemTrayManager, SYSTEMTRAY_MANAGER};

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn set_close_to_system_tray(enabled: bool) {
    let mut manager_guard = SYSTEMTRAY_MANAGER.lock().await;
    let manager: &mut SystemTrayManager = manager_guard.as_mut().unwrap();
    manager.close_to_tray = enabled;
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn set_start_in_system_tray(enabled: bool) {
    let mut manager_guard = SYSTEMTRAY_MANAGER.lock().await;
    let manager: &mut SystemTrayManager = manager_guard.as_mut().unwrap();
    manager.start_in_tray = enabled;
}

// This command exists for the JS side to request a window close.
// In Tauri V1, the appWindow.close() call does not get intercepted by the window close event handler.
// This will be changed in Tauri V2, in which this workaround will no longer be necessary: https://github.com/tauri-apps/tauri/issues/5288
#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn request_app_window_close(window: tauri::Window) {
    let mut manager_guard = SYSTEMTRAY_MANAGER.lock().await;
    let manager: &mut SystemTrayManager = manager_guard.as_mut().unwrap();
    super::handle_window_close_request(&window, None, manager.close_to_tray);
}
