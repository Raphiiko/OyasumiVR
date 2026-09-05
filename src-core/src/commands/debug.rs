#[cfg(debug_assertions)]
use tauri::Manager;

#[tauri::command]
pub fn dev_tools_available() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
pub async fn open_dev_tools(_app_handle: tauri::AppHandle) {
    #[cfg(debug_assertions)]
    _app_handle
        .get_webview_window("main")
        .unwrap()
        .open_devtools();
}
