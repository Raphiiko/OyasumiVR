use crate::system_tray::SYSTEMTRAY_MANAGER;
use log::debug;
use tauri::Manager;

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn close_splashscreen(window: tauri::Window) {
    debug!("[Core] Closing splash screen");
    // Close splashscreen
    if let Some(splashscreen) = window.get_window("splashscreen") {
        splashscreen.close().unwrap();
    }

    // Show the window if the "Start in system tray" option is set to false.
    // Otherwise, keep the window hidden until the user clicks the system tray icon to show it.
    if !SYSTEMTRAY_MANAGER
        .lock()
        .await
        .as_ref()
        .unwrap()
        .start_in_tray
    {
        let window = window.get_window("main").unwrap();
        window.show().unwrap();
        window.set_focus().unwrap();
    }
}
