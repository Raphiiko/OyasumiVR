use std::sync::{atomic::{AtomicBool, Ordering}, LazyLock};

use hidapi::{HidApi, HidDevice};
use log::{error, info, warn};
use tokio::sync::Mutex;

use crate::utils::send_event;

pub mod commands;
mod detector;

const BIGSCREEN_VID: u16 = 0x35bd;
const BEYOND_PID: u16 = 0x0101;

static BSB_CONNECTED: LazyLock<AtomicBool> = LazyLock::new(|| AtomicBool::new(false));
static BSB_DEVICE: LazyLock<Mutex<Option<HidDevice>>> = LazyLock::new(|| Mutex::new(None));

pub async fn init() {
    tokio::spawn(async move {
        let mut api = match HidApi::new() {
            Ok(a) => a,
            Err(e) => {
                error!("[Core] Failed to initialize HIDAPI: {}", e);
                return;
            }
        };
        // Check if beyond is currently connected
        match api.refresh_devices() {
            Ok(_) => {}
            Err(e) => {
                error!("[Core][Beyond] Could not refresh device list: {}", e);
                return;
            }
        }
        let devices = api.device_list();
        for device_info in devices {
            if device_info.vendor_id() == BIGSCREEN_VID && device_info.product_id() == BEYOND_PID {
                on_bsb_plugged(&api).await;
                break;
            }
        }
        // Detect USB plug/unplug events
        let mut detector = detector::PnPDetector::start();
        loop {
            let event = match detector.recv().await {
                Some(e) => e,
                None => {
                    warn!("[Core][Beyond] PnP detector task terminated");
                    return;
                }
            };
            match event {
                detector::PnPDetectorEvent::Plug { device_ref } => {
                    if device_ref.vid == BIGSCREEN_VID && device_ref.pid == BEYOND_PID {
                        on_bsb_plugged(&api).await;
                    }
                }
                detector::PnPDetectorEvent::Unplug { device_ref } => {
                    if device_ref.vid == BIGSCREEN_VID && device_ref.pid == BEYOND_PID {
                        on_bsb_unplugged().await;
                    }
                }
            }
        }
    });
}

async fn on_bsb_plugged(api: &HidApi) {
    let device = match api.open(BIGSCREEN_VID, BEYOND_PID) {
        Ok(d) => d,
        Err(e) => {
            error!(
                "[Core][Beyond] Could not open device for Bigscreen Beyond: {}",
                e
            );
            return;
        }
    };
    *BSB_DEVICE.lock().await = Some(device);
    BSB_CONNECTED.store(true, Ordering::Relaxed);
    info!("[Core] Bigscreen Beyond connected");
    send_event("BIGSCREEN_BEYOND_CONNECTED", true).await;
}

async fn on_bsb_unplugged() {
    *BSB_DEVICE.lock().await = None;
    BSB_CONNECTED.store(false, Ordering::Relaxed);
    info!("[Core] Bigscreen Beyond disconnected");
    send_event("BIGSCREEN_BEYOND_CONNECTED", false).await;
}

pub fn set_led_color(device: &HidDevice, r: u8, g: u8, b: u8) -> Result<(), String> {
    match device.send_feature_report(&[0, 0x4c, r, g, b]) {
        Ok(_) => Ok(()),
        Err(e) => {
            error!(
                "[Core][Beyond] Could not send data to Bigscreen Beyond: {}",
                e
            );
            Ok(())
            //             return Err("DEVICE_WRITE_ERROR".to_string());
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
    match device.send_feature_report(&[0, 0x46, speed]) {
        Ok(_) => Ok(()),
        Err(e) => {
            error!(
                "[Core][Beyond] Could not send data to Bigscreen Beyond: {}",
                e
            );
            Ok(())
            //             return Err("DEVICE_WRITE_ERROR".to_string());
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
            Ok(())
            //             return Err("DEVICE_WRITE_ERROR".to_string());
        }
    }
}
