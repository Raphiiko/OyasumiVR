use log::debug;
use tauri::Manager;

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn close_splashscreen(window: tauri::Window) {
    debug!("[Core] Closing splash screen");
    // Close splashscreen
    if let Some(splashscreen) = window.get_webview_window("splashscreen") {
        splashscreen.close().unwrap();
    }
}
