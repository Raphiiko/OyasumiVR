use log::error;

use super::{super::HIDAPI, BEYOND_PID, BIGSCREEN_VID};

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn bigscreen_beyond_set_brightness(brightness: u16) -> Result<(), String> {
    if brightness >= 0x0400 {
        error!(
            "[Core] Attempted to set brightness of Bigscreen Beyond to an out of bounds value: {}",
            brightness
        );
        return Err("OUT_OF_BOUNDS".to_string());
    }
    let api_guard = HIDAPI.lock().await;
    let api = match &*api_guard {
        Some(a) => a,
        None => {
            error!("[Core] Attempted to call bigscreen_beyond_set_brightness, but hidapi is not initialized");
            return Err("HIDAPI_NOT_INITIALIZED".to_string());
        }
    };
    let device = match api.open(BIGSCREEN_VID, BEYOND_PID) {
        Ok(d) => d,
        Err(e) => {
            error!("[Core] Could not open device for Bigscreen Beyond: {}", e);
            return Err("DEVICE_NOT_FOUND".to_string());
        }
    };
    let mut fan_percentage: u8 = 50;
    if brightness > 266 {
        fan_percentage = 100;
    }
    match device.send_feature_report(&[0, 0x46, fan_percentage as u8]) {
        Ok(_) => {}
        Err(e) => {
            error!("[Core] Could not send data to Bigscreen Beyond: {}", e);
            return Err("DEVICE_WRITE_ERROR".to_string());
        }
    };
    match device.send_feature_report(&[
        0,
        0x49,
        ((brightness >> 8) & 0xff) as u8,
        (brightness & 0xff) as u8,
    ]) {
        Ok(_) => Ok(()),
        Err(e) => {
            error!("[Core] Could not send data to Bigscreen Beyond: {}", e);
            return Err("DEVICE_WRITE_ERROR".to_string());
        }
    }
}
