#[tauri::command]
pub async fn clean_image_cache(only_expired: bool) {
    super::INSTANCE
        .lock()
        .await
        .as_mut()
        .unwrap()
        .clean(only_expired);
}
