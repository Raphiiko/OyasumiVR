use oyasumi_shared::models::OVRDevice;
use substring::Substring;
use super::OPENVR_MANAGER;

#[tauri::command]
pub async fn openvr_get_devices() -> Vec<OVRDevice> {
    let manager_guard = OPENVR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    manager.get_devices().await
}

#[tauri::command]
pub async fn openvr_status() -> String {
    let manager_guard = OPENVR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    let status = manager.get_status().await;
    let status_str = serde_json::to_string(&status).unwrap();
    status_str.substring(1, status_str.len() - 1).to_string()
}

#[tauri::command]
pub async fn openvr_set_analog_gain(analog_gain: f32) -> Result<(), String> {
    let manager_guard = OPENVR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    manager.set_analog_gain(analog_gain).await
}

#[tauri::command]
pub async fn openvr_get_analog_gain() -> Result<f32, String> {
    let manager_guard = OPENVR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    manager.get_analog_gain().await
}

#[tauri::command]
pub async fn openvr_set_supersample_scale(supersample_scale: Option<f32>) -> Result<(), String> {
    let manager_guard = OPENVR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    manager.set_supersample_scale(supersample_scale).await
}

#[tauri::command]
pub async fn openvr_get_supersample_scale() -> Result<Option<f32>, String> {
    let manager_guard = OPENVR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    manager.get_supersample_scale().await
}
