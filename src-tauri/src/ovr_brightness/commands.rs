#[tauri::command]
pub async fn openvr_set_image_brightness(brightness: f32) {
    super::set_brightness(brightness).await;
}
