use std::sync::atomic::{AtomicBool, Ordering};

use hidapi::{HidApi, HidDevice};
use log::{error, info};
use tokio::sync::Mutex;

use crate::utils::send_event;

pub mod commands;

const BIGSCREEN_VID: u16 = 0x35bd;
const BEYOND_PID: u16 = 0x0101;

lazy_static! {
    static ref BSB_CONNECTED: AtomicBool = AtomicBool::new(false);
    static ref BSB_DEVICE: Mutex<Option<HidDevice>> = Mutex::new(None);
}

pub async fn init() {
    let mut api = match HidApi::new() {
        Ok(a) => a,
        Err(e) => {
            error!("[Core] Failed to initialize HIDAPI: {}", e);
            return;
        }
    };

    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let _ = api.refresh_devices();
            let devices = api.device_list();
            let mut device: Option<HidDevice> = None;
            for device_info in devices {
                if device_info.vendor_id() == BIGSCREEN_VID
                    && device_info.product_id() == BEYOND_PID
                {
                    device = Some(match device_info.open_device(&api) {
                        Ok(d) => d,
                        Err(e) => {
                            error!(
                                "[Core][Beyond] Could not open device for Bigscreen Beyond: {}",
                                e
                            );
                            continue;
                        }
                    });
                    break;
                }
            }
            let connected = BSB_CONNECTED.load(Ordering::Relaxed);
            if connected && device.is_none() {
                *BSB_DEVICE.lock().await = None;
                BSB_CONNECTED.store(false, Ordering::Relaxed);
                info!("[Core] Bigscreen Beyond disconnected");
                send_event("BIGSCREEN_BEYOND_CONNECTED", false).await;
            } else if !connected && device.is_some() {
                *BSB_DEVICE.lock().await = device;
                BSB_CONNECTED.store(true, Ordering::Relaxed);
                info!("[Core] Bigscreen Beyond connected");
                send_event("BIGSCREEN_BEYOND_CONNECTED", true).await;
            }
        }
    });
}

pub fn set_led_color(device: &HidDevice, r: u8, g: u8, b: u8) -> Result<(), String> {
    match device.send_feature_report(&[0, 0x4c, r, g, b]) {
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

pub fn set_fan_speed(device: &HidDevice, speed: u8) -> Result<(), String> {
    if speed > 100 {
        error!(
            "[Core][Beyond] Attempted to set fan speed of Bigscreen Beyond to an out of bounds value: {}",
            speed
        );
        return Err("OUT_OF_BOUNDS".to_string());
    }
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

pub fn set_brightness(device: &HidDevice, brightness: u16) -> Result<(), String> {
    if brightness >= 0x0400 {
        error!(
            "[Core][Beyond] Attempted to set brightness of Bigscreen Beyond to an out of bounds value: {}",
            brightness
        );
        return Err("OUT_OF_BOUNDS".to_string());
    }
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
