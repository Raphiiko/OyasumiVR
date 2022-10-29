use log::debug;
use tauri::Manager;

#[tauri::command]
pub async fn close_splashscreen(window: tauri::Window) {
    debug!("[Core] Closing splash screen");
    // Close splashscreen
    if let Some(splashscreen) = window.get_window("splashscreen") {
        splashscreen.close().unwrap();
    }
    // Show main window
    window.get_window("main").unwrap().show().unwrap();
}
