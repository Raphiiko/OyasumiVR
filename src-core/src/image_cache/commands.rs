#[tauri::command]
pub async fn clean_image_cache(only_expired: bool) -> Result<(), String> {
    super::INSTANCE
        .lock()
        .await
        .as_mut()
        .unwrap()
        .clean(only_expired)
        .map_err(|error| error.to_string())
}
