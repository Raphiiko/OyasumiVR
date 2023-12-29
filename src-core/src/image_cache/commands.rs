#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn clean_image_cache(only_expired: bool) {
    super::INSTANCE
        .lock()
        .await
        .as_mut()
        .unwrap()
        .clean(only_expired);
}
