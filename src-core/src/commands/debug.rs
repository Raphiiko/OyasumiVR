use tauri::Manager;

use crate::globals::FLAGS;

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn open_dev_tools(app_handle: tauri::AppHandle) {
    app_handle
        .get_webview_window("main")
        .unwrap()
        .open_devtools();
}

#[tauri::command]
pub async fn is_flag_set(flag: String) -> bool {
    let flags = FLAGS.lock().await;
    if let Some(flags) = flags.as_ref() {
        return flags.get_bool(&flag).unwrap_or(false);
    }
    false
}
