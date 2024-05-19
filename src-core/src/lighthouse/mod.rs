pub mod commands;
pub mod models;

use std::{collections::HashMap, sync::Arc, time::Duration};

use bluest::{Adapter, Characteristic, Device, DeviceId, Service, Uuid};
use futures_util::StreamExt;
use log::{info, trace, warn};
use tokio::{sync::Mutex, time::sleep};

use crate::utils::send_event;

use self::models::{
    LighthouseDevice, LighthouseDeviceDiscoveredEvent, LighthouseDevicePowerStateChangedEvent,
    LighthouseDeviceType, LighthouseError, LighthousePowerState,
    LighthouseScanningStatusChangedEvent, LighthouseStatus, LighthouseStatusChangedEvent,
};

const LIGHTHOUSE_V2_SERVICE: Uuid = Uuid::from_u128(0x00001523_1212_EFDE_1523_785FEABCD124);
const LIGHTHOUSE_V2_POWER_CHARACTERISTIC: Uuid =
    Uuid::from_u128(0x00001525_1212_EFDE_1523_785FEABCD124);
static EVENT_STATUS_CHANGED: &str = "LIGHTHOUSE_STATUS_CHANGED";
static EVENT_SCANNING_STATUS_CHANGED: &str = "LIGHTHOUSE_SCANNING_STATUS_CHANGED";
static EVENT_DEVICE_DISCOVERED: &str = "LIGHTHOUSE_DEVICE_DISCOVERED";
static EVENT_DEVICE_POWER_STATE_CHANGED: &str = "LIGHTHOUSE_DEVICE_POWER_STATE_CHANGED";

// const LIGHTHOUSE_V2_IDENTIFY_CHARACTERISTIC: Uuid =
//     Uuid::from_u128(0x00008421_1212_EFDE_1523_785FEABCD124);
// const LIGHTHOUSE_V2_CHANNEL_CHARACTERISTIC: Uuid =
//     Uuid::from_u128(0x00001524_1212_EFDE_1523_785FEABCD124);

lazy_static! {
    static ref DISCOVERED_DEVICES: Mutex<Vec<DeviceId>> = Mutex::new(Vec::new());
    static ref LIGHTHOUSE_DEVICES: Arc<Mutex<Vec<Device>>> = Arc::new(Mutex::new(Vec::new()));
    static ref LIGHTHOUSE_DEVICE_POWER_STATES: Mutex<HashMap<String, LighthousePowerState>> =
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
            for device in devices.iter() {
                let _ = get_device_power_state(device.id().to_string()).await;
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

pub async fn get_devices() -> Vec<LighthouseDevice> {
    let devices_guard = LIGHTHOUSE_DEVICES.lock().await;
    let devices = devices_guard.clone();
    drop(devices_guard);
    let mut lighthouse_devices = Vec::new();
    for device in devices.iter() {
        lighthouse_devices.push(map_device_to_lighthouse_device(device.clone()).await);
    }
    lighthouse_devices
}

pub async fn get_device_power_state(
    device_id: String,
) -> Result<LighthousePowerState, LighthouseError> {
    let characteristic = match get_power_characteristic(device_id.clone()).await {
        Ok(characteristic) => characteristic,
        Err(err) => return Err(err),
    };
    // (Raphii): For personal testing purposes, I can pretend one of my basestations doesn't report its status
    // if device_id == "BluetoothLE#BluetoothLE48:51:c5:c6:5f:4c-f1:46:cc:56:2e:8c" {
    //     return Err(LighthouseError::CharacteristicNotFound);
    // }
    let value = match characteristic.read().await {
        Ok(value) => value,
        Err(err) => return Err(LighthouseError::FailedToReadCharacteristic(err)),
    };
    if value.len() != 1 {
        return Err(LighthouseError::InvalidCharacteristicValue);
    }
    let state = match value[0] {
        0x00 => LighthousePowerState::Sleep,
        0x02 => LighthousePowerState::Standby,
        0x0b => LighthousePowerState::On,
        0x01 | 0x08 | 0x09 => LighthousePowerState::Booting,
        _ => LighthousePowerState::Unknown,
    };
    // Get currently known power state
    let current_state = match LIGHTHOUSE_DEVICE_POWER_STATES.lock().await.get(&device_id) {
        Some(state) => state.clone(),
        None => LighthousePowerState::Unknown,
    };
    // Set the new state and send an event if the state has changed
    if current_state != state {
        LIGHTHOUSE_DEVICE_POWER_STATES
            .lock()
            .await
            .insert(device_id.clone(), state.clone());
        send_event(
            EVENT_DEVICE_POWER_STATE_CHANGED,
            LighthouseDevicePowerStateChangedEvent {
                device_id: device_id.clone(),
                power_state: state.clone(),
            },
        )
        .await;
    }
    Ok(state)
}

pub async fn set_device_power_state(
    device_id: String,
    state: LighthousePowerState,
) -> Result<(), LighthouseError> {
    let characteristic = match get_power_characteristic(device_id.clone()).await {
        Ok(characteristic) => characteristic,
        Err(err) => return Err(err),
    };
    let mut wrote_state = true;
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
            wrote_state = false;
        }
    };
    // Get currently known power state
    let current_state = match LIGHTHOUSE_DEVICE_POWER_STATES.lock().await.get(&device_id) {
        Some(state) => state.clone(),
        None => LighthousePowerState::Unknown,
    };
    // Fetch the new state for confirmation, if we changed it
    if wrote_state && current_state != state {
        let _ = get_device_power_state(device_id).await;
    }
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
        if lighthouse_devices_guard
            .iter()
            .any(|d| d.id().eq(&device_id))
        {
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
    // Check if it starts with LHB-
    if !device_name.starts_with("LHB-") {
        return;
    }
    // Get the device's services
    let services = match device.services().await {
        Ok(services) => services,
        Err(err) => {
            warn!(
                "[Core] Failed to get services of discovered device: {}",
                err
            );
            // Remove it from the discovered devices so that we may try again within the current scan period
            let mut discovered_devices_guard = DISCOVERED_DEVICES.lock().await;
            discovered_devices_guard.retain(|d| !d.eq(&device_id));
            return;
        }
    };
    // Check if it contains the lighthouse control service
    if !services
        .iter()
        .any(|service| service.uuid().eq(&LIGHTHOUSE_V2_SERVICE))
    {
        warn!("Discovered device does not contain the lighthouse control service");
        return;
    }
    // Add the device to the list of lighthouse devices
    {
        let mut lighthouse_devices_guard = LIGHTHOUSE_DEVICES.lock().await;
        lighthouse_devices_guard.push(device.clone());
    }
    // Send an event
    send_event(
        EVENT_DEVICE_DISCOVERED,
        LighthouseDeviceDiscoveredEvent {
            device: map_device_to_lighthouse_device(device.clone()).await,
        },
    )
    .await;
    info!("[Core] Discovered lighthouse device: {}", device_name);
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

async fn get_device(device_id: String) -> Option<Arc<Device>> {
    let devices = LIGHTHOUSE_DEVICES.lock().await;
    for device in devices.iter() {
        if device.id().to_string().eq(&device_id) {
            return Some(Arc::new(device.clone()));
        }
    }
    None
}

async fn get_lighthouse_service(device_id: String) -> Result<Service, LighthouseError> {
    let device = match get_device(device_id).await {
        Some(device) => device,
        None => return Err(LighthouseError::DeviceNotFound),
    };
    let services = match device.services().await {
        Ok(services) => services,
        Err(err) => return Err(LighthouseError::FailedToGetServices(err)),
    };
    let service = services
        .iter()
        .find(|service| service.uuid().eq(&LIGHTHOUSE_V2_SERVICE));
    match service {
        Some(service) => Ok(service.clone()),
        None => Err(LighthouseError::ServiceNotFound),
    }
}

async fn get_power_characteristic(device_id: String) -> Result<Characteristic, LighthouseError> {
    let service = match get_lighthouse_service(device_id).await {
        Ok(service) => service,
        Err(err) => return Err(err),
    };
    let characteristics = match service.characteristics().await {
        Ok(characteristics) => characteristics,
        Err(err) => return Err(LighthouseError::FailedToGetCharacteristics(err)),
    };
    let characteristic = characteristics.iter().find(|characteristic| {
        characteristic
            .uuid()
            .eq(&LIGHTHOUSE_V2_POWER_CHARACTERISTIC)
    });
    match characteristic {
        Some(characteristic) => Ok(characteristic.clone()),
        None => Err(LighthouseError::CharacteristicNotFound),
    }
}

async fn map_device_to_lighthouse_device(device: Device) -> LighthouseDevice {
    let power_state = match LIGHTHOUSE_DEVICE_POWER_STATES
        .lock()
        .await
        .get(&device.id().to_string())
    {
        Some(state) => state.clone(),
        None => LighthousePowerState::Unknown,
    };
    LighthouseDevice {
        id: device.id().to_string(),
        device_name: device.name().ok(),
        power_state,
        device_type: LighthouseDeviceType::LighthouseV2,
    }
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
                let _ = adapter.disconnect_device(&device).await;
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
}
