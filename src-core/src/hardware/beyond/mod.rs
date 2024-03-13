use log::{error, info};
use tokio::sync::Mutex;

use crate::utils::send_event;

pub mod commands;

const BIGSCREEN_VID: u16 = 0x35bd;
const BEYOND_PID: u16 = 0x0101;

lazy_static! {
    static ref BEYOND_CONNECTED: Mutex<bool> = Mutex::new(false);
}

pub async fn init() {
    tokio::spawn(async {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let mut api_guard = super::HIDAPI.lock().await;
            let api = match api_guard.as_mut() {
                Some(a) => a,
                None => continue,
            };
            let _ = api.refresh_devices();
            let devices = api.device_list();
            let mut found = false;
            for device in devices {
                if device.vendor_id() == BIGSCREEN_VID && device.product_id() == BEYOND_PID {
                    found = true;
                    break;
                }
            }
            let mut connected_guard = BEYOND_CONNECTED.lock().await;
            if *connected_guard != found {
                *connected_guard = found;
                if found {
                    info!("[Core] Bigscreen Beyond connected");
                    send_event("BIGSCREEN_BEYOND_CONNECTED", true).await;
                } else {
                    info!("[Core] Bigscreen Beyond disconnected");
                    send_event("BIGSCREEN_BEYOND_CONNECTED", false).await;
                }
            }
        }
    });
}

pub async fn set_fan_speed(speed: u8) -> Result<(), String> {
    if speed > 100 {
        error!(
            "[Core][Beyond] Attempted to set fan speed of Bigscreen Beyond to an out of bounds value: {}",
            speed
        );
        return Err("OUT_OF_BOUNDS".to_string());
    }
    let api_guard = super::HIDAPI.lock().await;
    let api = match &*api_guard {
        Some(a) => a,
        None => {
            error!("[Core][Beyond] Attempted to call set_fan_speed, but hidapi is not initialized");
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
    match device.send_feature_report(&[0, 0x46, speed as u8]) {
        Ok(_) => Ok(()),
        Err(e) => {
            error!(
                "[Core][Beyond] Could not send data to Bigscreen Beyond: {}",
                e
            );
            return Err("DEVICE_WRITE_ERROR".to_string());
        }
    }
}

pub async fn set_brightness(brightness: u16) -> Result<(), String> {
    if brightness >= 0x0400 {
        error!(
            "[Core][Beyond] Attempted to set brightness of Bigscreen Beyond to an out of bounds value: {}",
            brightness
        );
        return Err("OUT_OF_BOUNDS".to_string());
    }
    let api_guard = super::HIDAPI.lock().await;
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
    match device.send_feature_report(&[
        0,
        0x49,
        ((brightness >> 8) & 0xff) as u8,
        (brightness & 0xff) as u8,
    ]) {
        Ok(_) => Ok(()),
        Err(e) => {
            error!(
                "[Core][Beyond] Could not send data to Bigscreen Beyond: {}",
                e
            );
            return Err("DEVICE_WRITE_ERROR".to_string());
        }
    }
}
