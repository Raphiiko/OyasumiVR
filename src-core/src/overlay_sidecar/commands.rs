use std::time::Duration;

#[tauri::command]
pub async fn add_notification(message: String, duration: u64) -> Result<String, String> {
    super::add_notification(message, Duration::from_millis(duration)).await
}

#[tauri::command]
pub async fn clear_notification(notification_id: String) {
    super::clear_notification(notification_id).await;
}
