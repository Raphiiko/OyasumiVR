use super::{models::OVRDevice, OVR_CONTEXT};
use log::error;
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
pub async fn openvr_set_image_brightness(
    brightness: f64,
    perceived_brightness_adjustment_gamma: Option<f64>,
) {
    super::brightness_overlay::set_brightness(brightness, perceived_brightness_adjustment_gamma)
        .await;
}

#[tauri::command]
pub async fn openvr_launch_binding_configuration(show_on_desktop: bool) {
    let context = OVR_CONTEXT.lock().await;
    let mut input = match context.as_ref() {
        Some(context) => context.input_mngr(),
        None => return,
    };
    let input_handle = match input.get_input_source_handle("/user/hand/right") {
        Ok(handle) => handle,
        Err(e) => {
            error!("[Core] Failed to get input source handle: {}", e);
            return;
        }
    };
    if let Err(e) = input.open_binding_ui(None, None, input_handle, show_on_desktop) {
        error!("[Core] Failed to open SteamVR binding UI: {}", e);
    }
}
