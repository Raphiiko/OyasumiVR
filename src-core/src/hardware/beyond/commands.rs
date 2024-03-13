use tokio::sync::Mutex;

use super::BEYOND_CONNECTED;

lazy_static! {
    static ref FAN_FORCED: Mutex<bool> = Mutex::new(false);
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
    // Handle fan safety
    if fan_safety {
        let should_force = brightness > 0x010a; // >100%
        if should_force {
            // Force fan to 100% if brightness is over 100%
            match super::set_fan_speed(100).await {
                Ok(_) => {
                    let mut forced_guard = FAN_FORCED.lock().await;
                    *forced_guard = true;
                }
                Err(e) => return Err(e),
            }
        } else {
            // Restore the fan to 50% if it was forced before
            let mut forced_guard = FAN_FORCED.lock().await;
            if *forced_guard {
                match super::set_fan_speed(50).await {
                    Ok(_) => {
                        *forced_guard = false;
                    }
                    Err(e) => return Err(e),
                }
                *forced_guard = false;
            }
        }
    }
    // Set brightness
    match super::set_brightness(brightness).await {
        Ok(_) => Ok(()),
        Err(e) => Err(e),
    }
}
