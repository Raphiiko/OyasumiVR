use tauri::Manager;

#[tauri::command]
pub async fn open_dev_tools(app_handle: tauri::AppHandle) {
    app_handle.get_window("main").unwrap().open_devtools();
}
