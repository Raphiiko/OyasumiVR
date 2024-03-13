use std::sync::atomic::{AtomicBool, Ordering};

use log::error;

use crate::hardware::HIDAPI;

use super::{BEYOND_CONNECTED, BEYOND_PID, BIGSCREEN_VID};

lazy_static! {
    static ref FAN_FORCED: AtomicBool = AtomicBool::new(false);
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn bigscreen_beyond_is_connected() -> bool {
    let connected_guard = BEYOND_CONNECTED.lock().await;
    *connected_guard
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn bigscreen_beyond_set_brightness(
    brightness: u16,
    fan_safety: bool,
) -> Result<(), String> {
    let api_guard = HIDAPI.lock().await;
    let api = match &*api_guard {
        Some(a) => a,
        None => {
            error!(
                "[Core][Beyond] Attempted to call set_brightness, but hidapi is not initialized"
            );
            return Err("HIDAPI_NOT_INITIALIZED".to_string());
        }
    };
    let device = match api.open(BIGSCREEN_VID, BEYOND_PID) {
        Ok(d) => d,
        Err(e) => {
            error!(
                "[Core][Beyond] Could not open device for Bigscreen Beyond: {}",
                e
            );
            return Err("DEVICE_NOT_FOUND".to_string());
        }
    };

    // Handle fan safety
    if fan_safety {
        let should_force = brightness > 0x010a; // >100%
        if should_force {
            // Force fan to 100% if brightness is over 100%
            match super::set_fan_speed(&device, 100) {
                Ok(_) => {
                    FAN_FORCED.store(true, Ordering::Relaxed);
                }
                Err(e) => return Err(e),
            }
        } else {
            // Restore the fan to 50% if it was forced before
            if FAN_FORCED.load(Ordering::Relaxed) {
                match super::set_fan_speed(&device, 50) {
                    Ok(_) => {}
                    Err(e) => return Err(e),
                }
                FAN_FORCED.store(false, Ordering::Relaxed);
            }
        }
    }
    // Set brightness
    match super::set_brightness(&device, brightness) {
        Ok(_) => Ok(()),
        Err(e) => Err(e),
    }
}
