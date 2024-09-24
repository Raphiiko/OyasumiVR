pub mod commands;
pub mod models;

use std::{collections::HashMap, sync::Arc, time::Duration};

use bluest::{Adapter, Characteristic, Device, DeviceId, Service, Uuid};
use futures_util::StreamExt;
use log::{error, info, trace, warn};
use models::LighthouseDevice;
use tokio::{sync::Mutex, time::sleep};

use crate::utils::send_event;

use self::models::{
    LighthouseDeviceDiscoveredEvent, LighthouseDeviceModel, LighthouseDevicePowerStateChangedEvent,
    LighthouseDeviceType, LighthouseError, LighthousePowerState,
    LighthouseScanningStatusChangedEvent, LighthouseStatus, LighthouseStatusChangedEvent,
};

const LIGHTHOUSE_V1_PWR_SERVICE: Uuid = Uuid::from_u128(0x0000CB00_0000_1000_8000_00805F9B34FB);
const LIGHTHOUSE_V1_PWR_CHARACTERISTIC: Uuid =
    Uuid::from_u128(0x0000CB01_0000_1000_8000_00805F9B34FB);
const LIGHTHOUSE_V2_PWR_SERVICE: Uuid = Uuid::from_u128(0x00001523_1212_EFDE_1523_785FEABCD124);
const LIGHTHOUSE_V2_PWR_CHARACTERISTIC: Uuid =
    Uuid::from_u128(0x00001525_1212_EFDE_1523_785FEABCD124);
static EVENT_STATUS_CHANGED: &str = "LIGHTHOUSE_STATUS_CHANGED";
static EVENT_SCANNING_STATUS_CHANGED: &str = "LIGHTHOUSE_SCANNING_STATUS_CHANGED";
static EVENT_DEVICE_DISCOVERED: &str = "LIGHTHOUSE_DEVICE_DISCOVERED";
static EVENT_DEVICE_POWER_STATE_CHANGED: &str = "LIGHTHOUSE_DEVICE_POWER_STATE_CHANGED";

// const LIGHTHOUSE_V2_IDENTIFY_CHARACTERISTIC: Uuid =
//     Uuid::from_u128(0x00008421_1212_EFDE_1523_785FEABCD124);

lazy_static! {
    static ref DISCOVERED_DEVICES: Mutex<Vec<DeviceId>> = Mutex::new(Vec::new());
    static ref LIGHTHOUSE_DEVICES: Arc<Mutex<Vec<LighthouseDevice>>> =
        Arc::new(Mutex::new(Vec::new()));
    static ref LIGHTHOUSE_DEVICE_POWER_STATES: Mutex<HashMap<String, LighthousePowerState>> =
        Mutex::new(HashMap::new());
    static ref LIGHTHOUSE_DEVICE_V1_TIMEOUTS: Mutex<HashMap<String, u16>> =
        Mutex::new(HashMap::new());
    static ref SCANNING: Mutex<bool> = Mutex::new(false);
    static ref ADAPTER: Mutex<Option<Adapter>> = Mutex::default();
    static ref STATUS: Mutex<LighthouseStatus> = Mutex::new(LighthouseStatus::Uninitialized);
}

pub async fn init() {
    // Initialize adapter
    {
        let adapter = Adapter::default().await;
        if adapter.is_none() {
            set_lighthouse_status(LighthouseStatus::NoAdapter).await;
            warn!("[Core] No bluetooth adapter was found. Disabling lighthouse module.");
            return;
        }
        *ADAPTER.lock().await = adapter;
    }
    set_lighthouse_status(LighthouseStatus::Ready).await;
    // Poll the status of connected lighthouses every few seconds in a separate task
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(2)).await;
            let devices_guard = LIGHTHOUSE_DEVICES.lock().await;
            let devices = devices_guard.clone();
            drop(devices_guard);
            for d in devices.iter() {
                let _ = get_device_power_state(d.bt_device.id().to_string()).await;
            }
        }
    });
}

pub async fn start_scan(duration: Duration) {
    // Get the adapter
    let adapter_guard = ADAPTER.lock().await;
    let adapter = match adapter_guard.as_ref() {
        Some(adapter) => adapter,
        None => {
            // No bluetooth adapter was found, we stop here
            return;
        }
    };
    // Wait until the adapter is available
    if let Err(e) = adapter.wait_available().await {
        warn!(
            "[Core] Failed to wait for bluetooth adapter to become available: {}",
            e
        );
        set_scanning_status(false).await;
        return;
    }
    // Check if we are already scanning
    {
        if *SCANNING.lock().await {
            warn!("[Core] Already scanning for lighthouse devices");
            return;
        }
    }
    set_scanning_status(true).await;
    // Empty the lists of (discovered) devices
    {
        let mut discovered_devices_guard = DISCOVERED_DEVICES.lock().await;
        discovered_devices_guard.clear();
    }
    // Start the scan
    let mut scan = match adapter.scan(&[]).await {
        Ok(scan) => scan,
        Err(err) => {
            warn!("[Core] Failed to scan for lighthouse devices: {}", err);
            set_scanning_status(false).await;
            return;
        }
    };
    // Listen for scan scan results
    let mut timer = Box::pin(sleep(duration));
    loop {
        tokio::select! {
            _ = timer.as_mut() => {
                break;
            }
            result = scan.next() => {
                if let Some(discovered_device) = result {
                    tokio::spawn(handle_discovered_device(discovered_device.device));
                } else {
                    break;
                }
            }
        }
    }
    set_scanning_status(false).await;
}

pub async fn get_devices() -> Vec<LighthouseDeviceModel> {
    let devices_guard = LIGHTHOUSE_DEVICES.lock().await;
    let devices = devices_guard.clone();
    drop(devices_guard);
    let mut lighthouse_devices = Vec::new();
    for d in devices.iter() {
        lighthouse_devices.push(map_discovered_device_to_lighthouse_device(d.clone()).await);
    }
    lighthouse_devices
}

pub async fn get_device_power_state(
    device_id: String,
) -> Result<(LighthousePowerState, Option<u16>), LighthouseError> {
    let device = get_device(device_id.clone())
        .await
        .ok_or(LighthouseError::DeviceNotFound)?;
    let characteristic = match get_power_characteristic(device_id.clone()).await {
        Ok(characteristic) => characteristic,
        Err(err) => {
            return Err(err);
        }
    };
    let characteristic_props = match characteristic.properties().await {
        Ok(props) => props,
        Err(err) => {
            return Err(LighthouseError::FailedToGetCharacteristicProperties(err));
        }
    };
    if !characteristic_props.read {
        return Err(LighthouseError::CharacteristicDoesNotSupportRead);
    }
    let value = match characteristic.read().await {
        Ok(value) => value,
        Err(err) => {
            return Err(LighthouseError::FailedToReadCharacteristic(err));
        }
    };
    let (state, v1_timeout) = match device.device_type {
        LighthouseDeviceType::LighthouseV1 => {
            if value.len() < 4 {
                return Err(LighthouseError::InvalidCharacteristicValue);
            }
            let state = u16::from_be_bytes([value[2], value[3]]);
            if state == 0 {
                (LighthousePowerState::On, Some(state))
            } else if state <= 10 {
                (LighthousePowerState::Sleep, Some(state))
            } else {
                (LighthousePowerState::Unknown, Some(state))
            }
        }
        LighthouseDeviceType::LighthouseV2 => {
            if value.len() < 1 {
                return Err(LighthouseError::InvalidCharacteristicValue);
            }
            (
                match value[0] {
                    0x00 => LighthousePowerState::Sleep,
                    0x02 => LighthousePowerState::Standby,
                    0x0b => LighthousePowerState::On,
                    0x01 | 0x08 | 0x09 => LighthousePowerState::Booting,
                    _ => LighthousePowerState::Unknown,
                },
                None,
            )
        }
    };

    // Get currently known power state and timeout
    let current_state = match LIGHTHOUSE_DEVICE_POWER_STATES.lock().await.get(&device_id) {
        Some(state) => state.clone(),
        None => LighthousePowerState::Unknown,
    };
    let current_v1_timeout = match LIGHTHOUSE_DEVICE_V1_TIMEOUTS.lock().await.get(&device_id) {
        Some(timeout) => Some(timeout.clone()),
        None => None,
    };
    // Set the new state and send an event if the state or timeout has changed
    if current_state != state || current_v1_timeout != v1_timeout {
        LIGHTHOUSE_DEVICE_POWER_STATES
            .lock()
            .await
            .insert(device_id.clone(), state.clone());
        {
            let mut guard = LIGHTHOUSE_DEVICE_V1_TIMEOUTS.lock().await;
            if v1_timeout.is_some() {
                guard.insert(device_id.clone(), v1_timeout.unwrap());
            } else if guard.contains_key(&device_id) {
                guard.remove(&device_id);
            }
        }
        send_event(
            EVENT_DEVICE_POWER_STATE_CHANGED,
            LighthouseDevicePowerStateChangedEvent {
                device_id: device_id.clone(),
                power_state: state.clone(),
                v1_timeout,
            },
        )
        .await;
    }
    Ok((state, v1_timeout))
}

pub async fn set_device_power_state(
    device_id: String,
    state: LighthousePowerState,
    v1_timeout: Option<u16>,
    v1_identifier: Option<u32>,
) -> Result<(), LighthouseError> {
    let device = get_device(device_id.clone())
        .await
        .ok_or(LighthouseError::DeviceNotFound)?;
    let characteristic = match get_power_characteristic(device_id.clone()).await {
        Ok(characteristic) => characteristic,
        Err(err) => return Err(err),
    };
    match device.device_type {
        LighthouseDeviceType::LighthouseV1 => {
            match state {
                LighthousePowerState::On => {
                    // Determine payload
                    // (We ignore the identifier and timeout, as we want to stay on indefinitely)
                    let payload = [
                        0x12, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00,
                        0x00, 0x00,
                    ];
                    // Write command
                    let result = characteristic.write(&payload).await;
                    if let Err(e) = result {
                        error!(
                            "[Core] Failed to power on lighthouse device ({}) : {}",
                            device.device_name, e
                        );
                        return Err(LighthouseError::FailedToWriteCharacteristic(e));
                    }
                }
                LighthousePowerState::Sleep | LighthousePowerState::Standby => {
                    // Construct payload
                    let mut payload = [
                        0x12, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                        0x00, 0x00,
                    ];
                    // Set identifier
                    let identifier = v1_identifier.unwrap_or(0xffffffff);
                    payload[4..8].copy_from_slice(&identifier.to_le_bytes());
                    // Determine timeout
                    let mut timeout = v1_timeout.unwrap_or(1);
                    // If we don't have an identifier, switch command to 0x1201 (60 sec default)
                    if identifier == 0xffffffff {
                        payload[1] = 0x01;
                        timeout = 60;
                    }
                    // Set timeout
                    payload[2..4].copy_from_slice(&timeout.to_be_bytes());
                    // Write command
                    let result = characteristic.write(&payload).await;
                    if let Err(e) = result {
                        error!(
                            "[Core] Failed to power off lighthouse device ({}) : {}",
                            device.device_name, e
                        );
                        return Err(LighthouseError::FailedToWriteCharacteristic(e));
                    } else {
                        // Wait a bit for the device to actually power off
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    }
                }
                LighthousePowerState::Booting | LighthousePowerState::Unknown => {
                    warn!("[Core] Attempted to set lighthouse device power to an invalid state");
                }
            };
        }
        LighthouseDeviceType::LighthouseV2 => {
            match state {
                LighthousePowerState::Sleep => {
                    characteristic.write_without_response(&[0x00]).await;
                }
                LighthousePowerState::Standby => {
                    characteristic.write_without_response(&[0x02]).await;
                }
                LighthousePowerState::On => {
                    characteristic.write_without_response(&[0x01]).await;
                }
                LighthousePowerState::Booting | LighthousePowerState::Unknown => {
                    warn!("[Core] Attempted to set lighthouse device power to an invalid state");
                }
            };
        }
    };
    // Fetch the new state for confirmation
    let _ = get_device_power_state(device_id).await;
    Ok(())
}

async fn handle_discovered_device(device: Device) {
    let device_id = device.id();
    // Check if the device has already been discovered this scan
    {
        let mut discovered_devices_guard = DISCOVERED_DEVICES.lock().await;
        if discovered_devices_guard.contains(&device_id) {
            return;
        }
        discovered_devices_guard.push(device_id.clone());
    }
    // Check if the device is already known
    {
        let lighthouse_devices_guard = LIGHTHOUSE_DEVICES.lock().await;
        if lighthouse_devices_guard.iter().any(|d| d.id.eq(&device_id)) {
            return;
        }
    }
    // Get the device name
    let device_name = match device.name_async().await {
        Ok(name) => name,
        Err(err) => {
            trace!("[Core] Failed to get name of discovered device: {}", err);
            // Remove it from the discovered devices so that we may try again within the current scan period
            let mut discovered_devices_guard = DISCOVERED_DEVICES.lock().await;
            discovered_devices_guard.retain(|d| !d.eq(&device_id));
            return;
        }
    };
    // Check if it starts with known prefixes
    if !device_name.starts_with("LHB-") && !device_name.starts_with("HTC BS") {
        return;
    }
    // Get the device's services
    let services = match device.services().await {
        Ok(services) => services,
        Err(err) => {
            warn!(
                "[Core] Failed to get services of discovered device ({}): {}",
                device_name.clone(),
                err
            );
            // Remove it from the discovered devices so that we may try again within the current scan period
            let mut discovered_devices_guard = DISCOVERED_DEVICES.lock().await;
            discovered_devices_guard.retain(|d| !d.eq(&device_id));
            return;
        }
    };
    // Determine the device type based on the services present
    let device_type = {
        if services
            .iter()
            .any(|service| service.uuid().eq(&LIGHTHOUSE_V1_PWR_SERVICE))
        {
            LighthouseDeviceType::LighthouseV1
        } else if services
            .iter()
            .any(|service| service.uuid().eq(&LIGHTHOUSE_V2_PWR_SERVICE))
        {
            LighthouseDeviceType::LighthouseV2
        } else {
            warn!(
                "[Core] Discovered device does not contain a lighthouse control service: {}",
                device_name
            );
            return;
        }
    };
    // Add the device to the list of lighthouse devices
    let discovered_device = LighthouseDevice {
        id: device_id,
        device_name: device_name.clone(),
        device_type: device_type.clone(),
        bt_device: device.clone(),
    };
    {
        let mut lighthouse_devices_guard = LIGHTHOUSE_DEVICES.lock().await;
        lighthouse_devices_guard.push(discovered_device.clone());
    }
    // Send an event
    send_event(
        EVENT_DEVICE_DISCOVERED,
        LighthouseDeviceDiscoveredEvent {
            device: map_discovered_device_to_lighthouse_device(discovered_device.clone()).await,
        },
    )
    .await;
    info!(
        "[Core] Discovered {:#?} device: {}",
        device_type.clone(),
        device_name
    );
}

async fn set_lighthouse_status(status: LighthouseStatus) {
    *STATUS.lock().await = status.clone();
    send_event(
        EVENT_STATUS_CHANGED,
        LighthouseStatusChangedEvent {
            status: status.clone(),
        },
    )
    .await;
}

async fn set_scanning_status(scanning: bool) {
    *SCANNING.lock().await = scanning;
    send_event(
        EVENT_SCANNING_STATUS_CHANGED,
        LighthouseScanningStatusChangedEvent { scanning },
    )
    .await;
}

async fn get_device(device_id: String) -> Option<Arc<LighthouseDevice>> {
    let devices = LIGHTHOUSE_DEVICES.lock().await;
    for device in devices.iter() {
        if device.id.to_string().eq(&device_id) {
            return Some(Arc::new(device.clone()));
        }
    }
    None
}

async fn get_lighthouse_service(device: LighthouseDevice) -> Result<Service, LighthouseError> {
    let services = match device.bt_device.services().await {
        Ok(services) => services,
        Err(err) => return Err(LighthouseError::FailedToGetServices(err)),
    };
    let service_uuid = match device.device_type {
        LighthouseDeviceType::LighthouseV1 => LIGHTHOUSE_V1_PWR_SERVICE,
        LighthouseDeviceType::LighthouseV2 => LIGHTHOUSE_V2_PWR_SERVICE,
    };
    let service = services
        .iter()
        .find(|service| service.uuid().eq(&service_uuid));
    match service {
        Some(service) => Ok(service.clone()),
        None => Err(LighthouseError::ServiceNotFound),
    }
}

async fn get_power_characteristic(device_id: String) -> Result<Characteristic, LighthouseError> {
    let device = get_device(device_id)
        .await
        .ok_or(LighthouseError::DeviceNotFound)?;
    let service = match get_lighthouse_service(Arc::unwrap_or_clone(device.clone())).await {
        Ok(service) => service,
        Err(err) => return Err(err),
    };
    let characteristics = match service.characteristics().await {
        Ok(characteristics) => characteristics,
        Err(err) => return Err(LighthouseError::FailedToGetCharacteristics(err)),
    };
    let characteristic_uuid = match device.device_type {
        LighthouseDeviceType::LighthouseV1 => LIGHTHOUSE_V1_PWR_CHARACTERISTIC,
        LighthouseDeviceType::LighthouseV2 => LIGHTHOUSE_V2_PWR_CHARACTERISTIC,
    };
    let characteristic = characteristics
        .iter()
        .find(|characteristic| characteristic.uuid().eq(&characteristic_uuid));
    match characteristic {
        Some(characteristic) => Ok(characteristic.clone()),
        None => Err(LighthouseError::CharacteristicNotFound),
    }
}

async fn map_discovered_device_to_lighthouse_device(d: LighthouseDevice) -> LighthouseDeviceModel {
    let power_state = match LIGHTHOUSE_DEVICE_POWER_STATES
        .lock()
        .await
        .get(&d.bt_device.id().to_string())
    {
        Some(state) => state.clone(),
        None => LighthousePowerState::Unknown,
    };
    let v1_timeout = match LIGHTHOUSE_DEVICE_V1_TIMEOUTS
        .lock()
        .await
        .get(&d.bt_device.id().to_string())
    {
        Some(timeout) => Some(timeout.clone()),
        None => None,
    };
    let ld = LighthouseDeviceModel {
        id: d.id.to_string(),
        device_name: d.device_name,
        power_state,
        device_type: d.device_type,
        v1_timeout,
    };
    if ld.device_type == LighthouseDeviceType::LighthouseV1 {
        info!("LD: {:?}", ld);
    }
    ld
}

async fn reset() {
    // Wait until we are no longer scanning
    loop {
        let scanning_guard = SCANNING.lock().await;
        if !*scanning_guard {
            break;
        }
        drop(scanning_guard);
        sleep(Duration::from_millis(100)).await;
    }
    // Disconnect all devices
    {
        let adapter_guard = ADAPTER.lock().await;
        if let Some(adapter) = adapter_guard.as_ref() {
            let devices_guard = LIGHTHOUSE_DEVICES.lock().await;
            for device in devices_guard.iter() {
                let _ = adapter.disconnect_device(&device.bt_device).await;
            }
        }
    }
    // Clear all known devices
    {
        let mut lighthouse_devices_guard = LIGHTHOUSE_DEVICES.lock().await;
        lighthouse_devices_guard.clear();
    }
    // Clear all discovered devices
    {
        let mut discovered_devices_guard = DISCOVERED_DEVICES.lock().await;
        discovered_devices_guard.clear();
    }
    // Clear all known power states
    {
        let mut lighthouse_device_power_states_guard = LIGHTHOUSE_DEVICE_POWER_STATES.lock().await;
        lighthouse_device_power_states_guard.clear();
    }
    // Clear all known v1 timeout values
    {
        let mut lighthouse_device_v1_timeouts_guard = LIGHTHOUSE_DEVICE_V1_TIMEOUTS.lock().await;
        lighthouse_device_v1_timeouts_guard.clear();
    }
}
