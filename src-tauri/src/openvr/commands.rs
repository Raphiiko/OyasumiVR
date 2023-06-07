use super::models::OVRDevice;
use substring::Substring;

#[tauri::command]
pub async fn openvr_get_devices() -> Vec<OVRDevice> {
    super::devices::get_devices().await
}

#[tauri::command]
pub async fn openvr_status() -> String {
    let status = super::OVR_STATUS.lock().await;
    let status_str = serde_json::to_string(&*status).unwrap();
    status_str.substring(1, status_str.len() - 1).to_string()
}

#[tauri::command]
pub async fn openvr_set_analog_gain(analog_gain: f32) -> Result<(), String> {
    super::brightness_analog::set_analog_gain(analog_gain).await
}

#[tauri::command]
pub async fn openvr_get_analog_gain() -> Result<f32, String> {
    super::brightness_analog::get_analog_gain().await
}

#[tauri::command]
pub async fn openvr_set_supersample_scale(supersample_scale: Option<f32>) -> Result<(), String> {
    super::supersampling::set_supersample_scale(supersample_scale).await
}

#[tauri::command]
pub async fn openvr_get_supersample_scale() -> Result<Option<f32>, String> {
    super::supersampling::get_supersample_scale().await
}

#[tauri::command]
pub async fn openvr_set_fade_distance(fade_distance: f32) -> Result<(), String> {
    super::chaperone::set_fade_distance(fade_distance).await
}

#[tauri::command]
pub async fn openvr_get_fade_distance() -> Result<f32, String> {
    super::chaperone::get_fade_distance().await
}

#[tauri::command]
pub async fn openvr_set_image_brightness(brightness: f32) {
    super::brightness_overlay::set_brightness(brightness).await;
}
