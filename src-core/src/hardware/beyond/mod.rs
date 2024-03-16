use hidapi::{HidApi, HidDevice};
use log::{error, info};
use tokio::sync::{
    mpsc::{channel, Sender},
    Mutex,
};

use crate::utils::send_event;

pub mod commands;

const BIGSCREEN_VID: u16 = 0x35bd;
const BEYOND_PID: u16 = 0x0101;

lazy_static! {
    static ref BEYOND_CONNECTED: Mutex<bool> = Mutex::new(false);
    static ref BSB_TX: Mutex<Option<Sender<BSBAction>>> = Mutex::new(None);
}

pub async fn init() {
    start_communicator_thread().await;
}

async fn invoke_bsb_action(action: BSBAction) {
    let tx_guard = BSB_TX.lock().await;
    let tx = match tx_guard.as_ref() {
        Some(t) => t,
        None => return,
    };
    let _ = tx.send(action).await;
}

pub async fn set_led_color(r: u8, g: u8, b: u8) {
    invoke_bsb_action(BSBAction {
        action_type: BSBActionType::SetLedColor,
        brightness: None,
        fan_speed: None,
        led_color: Some((r, g, b)),
    })
    .await;
}

fn set_led_color_internal(device: &HidDevice, r: u8, g: u8, b: u8) -> Result<(), String> {
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

pub async fn set_fan_speed(speed: u8) {
    invoke_bsb_action(BSBAction {
        action_type: BSBActionType::SetFanSpeed,
        brightness: None,
        fan_speed: Some(speed),
        led_color: None,
    })
    .await;
}

fn set_fan_speed_internal(device: &HidDevice, speed: u8) -> Result<(), String> {
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

pub async fn set_brightness(brightness: u16) {
    invoke_bsb_action(BSBAction {
        action_type: BSBActionType::SetBrightness,
        brightness: Some(brightness),
        fan_speed: None,
        led_color: None,
    })
    .await;
}

fn set_brightness_internal(device: &HidDevice, brightness: u16) -> Result<(), String> {
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

enum BSBActionType {
    SetBrightness,
    SetFanSpeed,
    SetLedColor,
    CheckConnection,
}

struct BSBAction {
    pub action_type: BSBActionType,
    pub brightness: Option<u16>,
    pub fan_speed: Option<u8>,
    pub led_color: Option<(u8, u8, u8)>,
}

pub async fn start_communicator_thread() {
    let mut api = match HidApi::new() {
        Ok(a) => a,
        Err(e) => {
            error!("[Core] Failed to initialize HIDAPI: {}", e);
            return;
        }
    };
    let (tx, mut rx) = channel::<BSBAction>(100);
    *BSB_TX.lock().await = Some(tx);

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
            if device.is_none() {
                continue;
            }

            let device = device.unwrap();
            info!("[Core] Bigscreen Beyond connected");
            *BEYOND_CONNECTED.lock().await = true;
            send_event("BIGSCREEN_BEYOND_CONNECTED", true).await;

            'recv_loop: while let Some(action) = rx.recv().await {
                match action.action_type {
                    BSBActionType::SetBrightness => {
                        if let Some(brightness) = action.brightness {
                            let _ = set_brightness_internal(&device, brightness);
                        }
                    }
                    BSBActionType::SetFanSpeed => {
                        if let Some(fan_speed) = action.fan_speed {
                            let _ = set_fan_speed_internal(&device, fan_speed);
                        }
                    }
                    BSBActionType::SetLedColor => {
                        if let Some((r, g, b)) = action.led_color {
                            let _ = set_led_color_internal(&device, r, g, b);
                        }
                    }
                    BSBActionType::CheckConnection => {
                        let _ = api.refresh_devices();
                        let devices = api.device_list();
                        for device_info in devices {
                            if device_info.vendor_id() == BIGSCREEN_VID
                                && device_info.product_id() == BEYOND_PID
                            {
                                continue 'recv_loop;
                            }
                        }
                        info!("[Core] Bigscreen Beyond disconnected");
                        *BEYOND_CONNECTED.lock().await = false;
                        send_event("BIGSCREEN_BEYOND_CONNECTED", false).await;
                        break;
                    }
                }
            }
        }
    });

    // Check device connection periodically
    tokio::spawn(async {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            if !*BEYOND_CONNECTED.lock().await {
                continue;
            }
            let tx_guard = BSB_TX.lock().await;
            let tx = match tx_guard.as_ref() {
                Some(t) => t,
                None => continue,
            };
            let _ = tx
                .send(BSBAction {
                    action_type: BSBActionType::CheckConnection,
                    brightness: None,
                    fan_speed: None,
                    led_color: None,
                })
                .await;
        }
    });
}
