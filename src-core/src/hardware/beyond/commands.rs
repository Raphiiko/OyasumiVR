use std::sync::atomic::Ordering;

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn bigscreen_beyond_is_connected() -> bool {
    super::BSB_CONNECTED.load(Ordering::Relaxed)
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn bigscreen_beyond_set_led_color(r: u8, g: u8, b: u8) -> Result<(), String> {
    let device = super::BSB_DEVICE.lock().await;
    match device.as_ref() {
        Some(d) => super::set_led_color(d, r, g, b),
        None => Err("Bigscreen Beyond is not connected".to_string()),
    }
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn bigscreen_beyond_set_fan_speed(speed: u8) -> Result<(), String> {
    let device = super::BSB_DEVICE.lock().await;
    match device.as_ref() {
        Some(d) => super::set_fan_speed(d, speed),
        None => Err("Bigscreen Beyond is not connected".to_string()),
    }
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn bigscreen_beyond_set_brightness(brightness: u16) -> Result<(), String> {
    let device = super::BSB_DEVICE.lock().await;
    match device.as_ref() {
        Some(d) => super::set_brightness(d, brightness),
        None => Err("Bigscreen Beyond is not connected".to_string()),
    }
}
