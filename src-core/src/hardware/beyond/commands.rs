use std::sync::atomic::{AtomicBool, Ordering};

lazy_static! {
    static ref FAN_FORCED: AtomicBool = AtomicBool::new(false);
}

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
pub async fn bigscreen_beyond_set_brightness(
    brightness: u16,
    fan_safety: bool,
) -> Result<(), String> {
    let device_guard = super::BSB_DEVICE.lock().await;
    if device_guard.is_none() {
        return Err("Bigscreen Beyond is not connected".to_string());
    }
    let device = device_guard.as_ref().unwrap();
    // Handle fan safety
    if fan_safety {
        let should_force = brightness > 0x010a; // >100%
        if should_force {
            // Force fan to 100% if brightness is over 100%
            match super::set_fan_speed(device, 100) {
                Ok(_) => {
                    FAN_FORCED.store(true, Ordering::Relaxed);
                }
                Err(e) => return Err(e),
            }
        } else {
            // Restore the fan to 50% if it was forced before
            if FAN_FORCED.load(Ordering::Relaxed) {
                match super::set_fan_speed(device, 50) {
                    Ok(_) => {
                        FAN_FORCED.store(false, Ordering::Relaxed);
                    }
                    Err(e) => return Err(e),
                }
            }
        }
    }
    // Set brightness
    super::set_brightness(device, brightness)
}
