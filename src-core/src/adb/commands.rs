use log::debug;
use std::net::{Ipv4Addr, SocketAddrV4};

use adb_client::{ADBDeviceExt, RustADBError};

use crate::adb::models::ADBDeviceState;

use super::models::{ADBDevice, ADBServerStatus};

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn adb_get_server_status() -> ADBServerStatus {
    debug!("[Core] [adb_get_server_status] LOCK...");
    let mut server = super::ADB_SERVER.lock().await;
    debug!("[Core] [adb_get_server_status] LOCKED");
    match server.server_status() {
        Ok(_) => return ADBServerStatus::Running,
        Err(RustADBError::IOError(e)) => {
            return ADBServerStatus::NotFound(e.to_string());
        }
        Err(e) => {
            return ADBServerStatus::UnknownError(e.to_string());
        }
    };
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn adb_get_devices() -> Result<Vec<ADBDevice>, String> {
    if adb_get_server_status().await != ADBServerStatus::Running {
        return Err("ADB_SERVER_NOT_RUNNING".to_string());
    }
    let mut server = super::ADB_SERVER.lock().await;
    match server.devices_long() {
        Ok(devices) => Ok(devices.into_iter().map(|device| device.into()).collect()),
        Err(e) => {
            log::error!("[Core] Failed to get devices: {}", e);
            return Err("ADB_GET_DEVICES_FAILED".to_string());
        }
    }
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn adb_get_device_status(id: String) -> Result<ADBDeviceState, String> {
    let devices = adb_get_devices().await?;
    let device = devices
        .into_iter()
        .find(|device| device.identifier.as_str() == id.as_str());
    if device.is_none() {
        return Err("DEVICE_NOT_FOUND".to_string());
    }
    Ok(device.unwrap().state.into())
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn adb_set_brightness(id: String, brightness: u8) -> Result<(), String> {
    let mut server = super::ADB_SERVER.lock().await;
    let mut device = match server.get_device_by_name(id.as_str()) {
        Ok(device) => device,
        Err(_) => {
            return Err("ADB_SET_BRIGHTNESS_DEVICE_NOT_FOUND".to_string());
        }
    };
    let result = device.shell_command(
        &[
            "settings",
            "put",
            "system",
            "screen_brightness",
            brightness.to_string().as_str(),
        ],
        &mut std::io::sink(),
    );
    if result.is_err() {
        return Err("ADB_SET_BRIGHTNESS_CMD_FAILED".to_string());
    }
    Ok(())
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn adb_get_brightness(id: String) -> Result<u8, String> {
    let mut server = super::ADB_SERVER.lock().await;
    let mut device = match server.get_device_by_name(id.as_str()) {
        Ok(device) => device,
        Err(_) => {
            return Err("ADB_GET_BRIGHTNESS_DEVICE_NOT_FOUND".to_string());
        }
    };
    let mut output = Vec::new();
    let result = device.shell_command(
        &["settings", "get", "system", "screen_brightness"],
        &mut output,
    );
    if result.is_err() {
        return Err("ADB_GET_BRIGHTNESS_CMD_FAILED".to_string());
    }
    let output_str = String::from_utf8_lossy(&output).trim().to_string();
    let brightness = output_str
        .parse::<u8>()
        .map_err(|_| "ADB_GET_BRIGHTNESS_PARSE_FAILED".to_string())?;
    Ok(brightness)
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn adb_connect_device(host: String, port: u16) -> Result<(), String> {
    debug!("CONNECT 1");
    let ip = host
        .parse::<Ipv4Addr>()
        .map_err(|_| "INVALID_IP_ADDRESS".to_string())?;
    debug!("CONNECT 2");
    let address = SocketAddrV4::new(ip, port);
    debug!("CONNECT 3");
    if adb_get_server_status().await != ADBServerStatus::Running {
        return Err("ADB_SERVER_NOT_RUNNING".to_string());
    }
    debug!("CONNECT 4");
    let result = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        let mut server = super::ADB_SERVER.lock().await;
        server.connect_device(address)
    })
    .await;
    debug!("CONNECT 5");

    match result {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(e)) => Err(format!("ADB_CONNECT_FAILED: {}", e)),
        Err(_) => Err("ADB_CONNECT_TIMEOUT".to_string()),
    }
}
