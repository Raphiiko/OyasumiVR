use std::sync::atomic::{AtomicBool, Ordering};

use super::BEYOND_CONNECTED;

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
pub async fn bigscreen_beyond_set_led_color(r: u8, g: u8, b: u8) {
    super::set_led_color(r, g, b).await;
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn bigscreen_beyond_set_brightness(brightness: u16, fan_safety: bool) {
    // Handle fan safety
    if fan_safety {
        let should_force = brightness > 0x010a; // >100%
        if should_force {
            // Force fan to 100% if brightness is over 100%
            super::set_fan_speed(100).await;
            FAN_FORCED.store(true, Ordering::Relaxed);
        } else {
            // Restore the fan to 50% if it was forced before
            if FAN_FORCED.load(Ordering::Relaxed) {
                super::set_fan_speed(50).await;
                FAN_FORCED.store(false, Ordering::Relaxed);
            }
        }
    }
    // Set brightness
    super::set_brightness(brightness).await;
}
