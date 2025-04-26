use tauri::Manager;

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn open_dev_tools(app_handle: tauri::AppHandle) {
    app_handle.get_webview_window("main").unwrap().open_devtools();
}
