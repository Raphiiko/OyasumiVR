use std::sync::atomic::Ordering;

use log::{error, warn};
use steamlocate::SteamDir;

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn bigscreen_beyond_is_connected() -> bool {
    super::BSB_CONNECTED.load(Ordering::Relaxed)
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn bigscreen_beyond_get_saved_preferences() -> Result<Option<String>, String> {
    let mut steamdir = match SteamDir::locate() {
        Some(dir) => dir,
        None => {
            warn!("[Core] Failed to locate Steam installation directory");
            return Ok(None);
        }
    };
    let app = match steamdir.app(&2467050) {
        Some(app) => app,
        None => {
            warn!("[Core] Failed to locate Bigscreen Beyond Driver installation directory");
            return Ok(None);
        }
    };
    let path = app.path.join("bin").join("beyond_settings.json");
    if !path.exists() || !path.is_file() {
        return Ok(None);
    }
    match tokio::fs::read_to_string(path).await {
        Ok(contents) => Ok(Some(contents)),
        Err(e) => {
            error!(
                "[Core] Failed to read Bigscreen Beyond settings file: {}",
                e
            );
            Err("READ_ERROR".to_string())
        }
    }
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
