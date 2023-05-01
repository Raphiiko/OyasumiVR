use log::debug;
use tauri::Manager;

use crate::{commands::system_tray::SystemTrayManager, SYSTEMTRAY_MANAGER};

#[tauri::command]
pub async fn close_splashscreen(window: tauri::Window) {
    debug!("[Core] Closing splash screen");
    // Close splashscreen
    if let Some(splashscreen) = window.get_window("splashscreen") {
        splashscreen.close().unwrap();
    }

    // Show the window if the "Start with system tray" config is set to false.
    // Otherwise, keep the window hidden until the user clicks the system tray icon to show it.
    let manager_guard = SYSTEMTRAY_MANAGER.lock().unwrap();
    let manager: &SystemTrayManager = manager_guard.as_ref().unwrap();

    if !manager.start_in_tray {
        window.get_window("main").unwrap().show().unwrap();
    }
}
