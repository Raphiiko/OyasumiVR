pub mod commands;
pub mod models;

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, LazyLock},
    time::Duration,
};

use btleplug::{
    api::{
        Central, CentralEvent, CharPropFlags, Characteristic, Manager as _, Peripheral as _,
        ScanFilter, WriteType,
    },
    platform::{Adapter, Manager, Peripheral, PeripheralId},
};
use futures_util::{future::join_all, StreamExt};
use log::{debug, error, info, trace, warn};
use models::LighthouseDevice;
use tokio::{sync::Mutex, time::sleep};
use uuid::Uuid;

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

static LIGHTHOUSE_DEVICES: LazyLock<Arc<Mutex<Vec<LighthouseDevice>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(Vec::new())));
static LIGHTHOUSE_DEVICE_POWER_STATES: LazyLock<Mutex<HashMap<String, LighthousePowerState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static LIGHTHOUSE_DEVICE_V1_TIMEOUTS: LazyLock<Mutex<HashMap<String, u16>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static SCANNING: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));
static ADAPTER: LazyLock<Mutex<Option<Adapter>>> = LazyLock::new(Mutex::default);
static STATUS: LazyLock<Mutex<LighthouseStatus>> =
    LazyLock::new(|| Mutex::new(LighthouseStatus::Uninitialized));
static PROCESSING_DEVICES: LazyLock<Mutex<HashSet<PeripheralId>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_RETRY_COOLDOWN: Duration = Duration::from_secs(10);
const SCAN_START_RETRY_DELAY: Duration = Duration::from_secs(10);

pub async fn init() {
    // Initialize adapter
    let adapter = {
        let manager = match Manager::new().await {
            Ok(manager) => manager,
            Err(err) => {
                error!("[Core] Failed to initialize the bluetooth manager: {err}");
                set_lighthouse_status(LighthouseStatus::AdapterError).await;
                return;
            }
        };
        let adapter = match manager.adapters().await {
            Ok(adapters) => adapters.into_iter().next(),
            Err(err) => {
                error!("[Core] Failed to list the bluetooth adapters: {err}");
                set_lighthouse_status(LighthouseStatus::AdapterError).await;
                return;
            }
        };
        match adapter {
            Some(adapter) => adapter,
            None => {
                set_lighthouse_status(LighthouseStatus::NoAdapter).await;
                warn!("[Core] No bluetooth adapter was found. Disabling lighthouse module.");
                return;
            }
        }
    };
    *ADAPTER.lock().await = Some(adapter.clone());
    set_lighthouse_status(LighthouseStatus::Ready).await;
    tokio::spawn(scan_for_devices(adapter));
    // Poll the status of connected lighthouses every few seconds in a separate task
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(2)).await;
            let devices_guard = LIGHTHOUSE_DEVICES.lock().await;
            let devices = devices_guard.clone();
            drop(devices_guard);
            // Polled together, so an unreachable device cannot hold up the others
            join_all(
                devices
                    .iter()
                    .map(|d| get_device_power_state(d.id.to_string())),
            )
            .await;
        }
    });
}

/// Runs for the lifetime of the process because btleplug retains each scan handler.
async fn scan_for_devices(adapter: Adapter) {
    // Subscribing after the scan starts would miss the first advertisements
    let mut events = match adapter.events().await {
        Ok(events) => events,
        Err(err) => {
            error!("[Core] Failed to listen for bluetooth adapter events: {err}");
            return;
        }
    };
    let mut reported = false;
    while let Err(err) = adapter.start_scan(ScanFilter::default()).await {
        if !reported {
            warn!("[Core] Failed to scan for lighthouse devices: {err}");
            reported = true;
        }
        sleep(SCAN_START_RETRY_DELAY).await;
    }
    while let Some(event) = events.next().await {
        let device_id = match event {
            CentralEvent::DeviceDiscovered(id) | CentralEvent::DeviceUpdated(id) => id,
            _ => continue,
        };
        if !*SCANNING.lock().await {
            continue;
        }
        if let Ok(peripheral) = adapter.peripheral(&device_id).await {
            tokio::spawn(handle_discovered_device(peripheral));
        }
    }
}

pub async fn start_scan(duration: Duration) {
    if ADAPTER.lock().await.is_none() {
        return;
    }
    // Claim the scanning state, so two commands cannot open a window at the same time
    {
        let mut scanning_guard = SCANNING.lock().await;
        if *scanning_guard {
            warn!("[Core] Already scanning for lighthouse devices");
            return;
        }
        *scanning_guard = true;
    }
    send_event(
        EVENT_SCANNING_STATUS_CHANGED,
        LighthouseScanningStatusChangedEvent { scanning: true },
    )
    .await;
    sleep(duration).await;
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
    let value = {
        let op_lock = device.op_lock.clone();
        let _guard = op_lock.lock().await;
        let (peripheral, characteristic) = get_power_characteristic(device_id.clone()).await?;
        if !characteristic.properties.contains(CharPropFlags::READ) {
            return Err(LighthouseError::CharacteristicDoesNotSupportRead);
        }
        match peripheral.read(&characteristic).await {
            Ok(value) => value,
            Err(err) => {
                // Drop the stale session so the next attempt rediscovers the services
                let _ = peripheral.disconnect().await;
                return Err(LighthouseError::FailedToReadCharacteristic(err));
            }
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
            if value.is_empty() {
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

    // Get currently known power state and timeout, and update atomically
    let (state_changed, timeout_changed) = {
        let mut power_states_guard = LIGHTHOUSE_DEVICE_POWER_STATES.lock().await;
        let mut timeouts_guard = LIGHTHOUSE_DEVICE_V1_TIMEOUTS.lock().await;

        let current_state = power_states_guard
            .get(&device_id)
            .cloned()
            .unwrap_or(LighthousePowerState::Unknown);
        let current_v1_timeout = timeouts_guard.get(&device_id).copied();

        let state_changed = current_state != state;
        let timeout_changed = current_v1_timeout != v1_timeout;

        // Update state if changed
        if state_changed {
            power_states_guard.insert(device_id.clone(), state.clone());
        }

        // Update timeout if changed
        if timeout_changed {
            if let Some(timeout) = v1_timeout {
                timeouts_guard.insert(device_id.clone(), timeout);
            } else if timeouts_guard.contains_key(&device_id) {
                timeouts_guard.remove(&device_id);
            }
        }

        (state_changed, timeout_changed)
    };

    // Send event if either state or timeout changed
    if state_changed || timeout_changed {
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
    let op_lock = device.op_lock.clone();
    let guard = op_lock.lock().await;
    let (peripheral, characteristic) = get_power_characteristic(device_id.clone()).await?;
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
                    let result = peripheral
                        .write(&characteristic, &payload, WriteType::WithResponse)
                        .await;
                    if let Err(e) = result {
                        error!(
                            "[Core] Failed to power on lighthouse device ({}) : {}",
                            device.device_name, e
                        );
                        let _ = peripheral.disconnect().await;
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
                    let result = peripheral
                        .write(&characteristic, &payload, WriteType::WithResponse)
                        .await;
                    if let Err(e) = result {
                        error!(
                            "[Core] Failed to power off lighthouse device ({}) : {}",
                            device.device_name, e
                        );
                        let _ = peripheral.disconnect().await;
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
            let value = match state {
                LighthousePowerState::Sleep => Some(0x00),
                LighthousePowerState::Standby => Some(0x02),
                LighthousePowerState::On => Some(0x01),
                LighthousePowerState::Booting | LighthousePowerState::Unknown => {
                    warn!("[Core] Attempted to set lighthouse device power to an invalid state");
                    None
                }
            };
            if let Some(value) = value {
                if let Err(e) = write_v2_power(&peripheral, &characteristic, value).await {
                    error!(
                        "[Core] Failed to set the power state of lighthouse device ({}) : {}",
                        device.device_name, e
                    );
                    // Drop the stale session so the next attempt rediscovers the services
                    let _ = peripheral.disconnect().await;
                    return Err(LighthouseError::FailedToWriteCharacteristic(e));
                }
            }
        }
    };
    drop(guard);
    // Fetch the new state for confirmation
    let _ = get_device_power_state(device_id).await;
    Ok(())
}

async fn handle_discovered_device(device: Peripheral) {
    let device_id = device.id();

    // Check if this device is already being processed and add it atomically
    {
        let mut processing_devices_guard = PROCESSING_DEVICES.lock().await;
        if !processing_devices_guard.insert(device_id.clone()) {
            return;
        }
    }
    if !identify_discovered_device(&device, &device_id).await {
        // Held in PROCESSING_DEVICES meanwhile, so further advertisements are ignored
        sleep(CONNECT_RETRY_COOLDOWN).await;
    }
    PROCESSING_DEVICES.lock().await.remove(&device_id);
}

async fn identify_discovered_device(device: &Peripheral, device_id: &PeripheralId) -> bool {
    // Check if the device is already known
    {
        let lighthouse_devices_guard = LIGHTHOUSE_DEVICES.lock().await;
        if lighthouse_devices_guard.iter().any(|d| d.id.eq(device_id)) {
            return true;
        }
    }
    // Get the advertised device name
    let device_name = match device.properties().await {
        Ok(Some(properties)) => properties.local_name.unwrap_or_default(),
        Ok(None) => return true,
        Err(err) => {
            trace!("[Core] Failed to get properties of discovered device: {err}");
            return true;
        }
    };
    // Check if it starts with known prefixes
    if (!device_name.starts_with("LHB-") && !device_name.starts_with("HTC BS"))
        || device_name == "LHB-00000000"
    {
        return true;
    }
    // Connect and enumerate the device's services
    let services = {
        if let Err(err) = ensure_connected(device, &device_name).await {
            warn!("[Core] Failed to connect to discovered device ({device_name}): {err:?}");
            let _ = device.disconnect().await;
            return false;
        }
        device.services()
    };
    // Determine the device type based on the services present
    let device_type = {
        if services
            .iter()
            .any(|service| service.uuid.eq(&LIGHTHOUSE_V1_PWR_SERVICE))
        {
            LighthouseDeviceType::LighthouseV1
        } else if services
            .iter()
            .any(|service| service.uuid.eq(&LIGHTHOUSE_V2_PWR_SERVICE))
        {
            LighthouseDeviceType::LighthouseV2
        } else {
            warn!(
                "[Core] Discovered device does not contain a lighthouse control service: {device_name}"
            );
            let _ = device.disconnect().await;
            return false;
        }
    };
    // Add the device to the list of lighthouse devices
    let discovered_device = LighthouseDevice {
        id: device_id.clone(),
        device_name: device_name.clone(),
        device_type: device_type.clone(),
        bt_device: device.clone(),
        op_lock: Arc::new(Mutex::new(())),
    };
    {
        let mut lighthouse_devices_guard = LIGHTHOUSE_DEVICES.lock().await;
        // Double-check that device hasn't been added by another thread
        if lighthouse_devices_guard.iter().any(|d| d.id.eq(device_id)) {
            return true;
        }
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
    true
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

async fn get_device(device_id: String) -> Option<LighthouseDevice> {
    let devices = LIGHTHOUSE_DEVICES.lock().await;
    devices
        .iter()
        .find(|device| device.id.to_string().eq(&device_id))
        .cloned()
}

async fn write_v2_power(
    peripheral: &Peripheral,
    characteristic: &Characteristic,
    value: u8,
) -> Result<(), btleplug::Error> {
    peripheral
        .write(characteristic, &[value], WriteType::WithoutResponse)
        .await
}

async fn ensure_connected(device: &Peripheral, device_name: &str) -> Result<(), LighthouseError> {
    if device.is_connected().await.unwrap_or(false) {
        return Ok(());
    }
    debug!("[Core] Connecting to lighthouse device: {device_name}");
    // The cached service handles are invalid after a reconnect, so drop them first
    let _ = device.disconnect().await;
    device
        .connect_with_timeout(CONNECT_TIMEOUT)
        .await
        .map_err(LighthouseError::FailedToConnect)?;
    if let Err(err) = device.discover_services_with_timeout(CONNECT_TIMEOUT).await {
        // Leaving it connected without services would make every later operation fail
        let _ = device.disconnect().await;
        return Err(LighthouseError::FailedToGetServices(err));
    }
    Ok(())
}

async fn get_power_characteristic(
    device_id: String,
) -> Result<(Peripheral, Characteristic), LighthouseError> {
    let device = get_device(device_id)
        .await
        .ok_or(LighthouseError::DeviceNotFound)?;
    ensure_connected(&device.bt_device, &device.device_name).await?;
    let (service_uuid, characteristic_uuid) = match device.device_type {
        LighthouseDeviceType::LighthouseV1 => {
            (LIGHTHOUSE_V1_PWR_SERVICE, LIGHTHOUSE_V1_PWR_CHARACTERISTIC)
        }
        LighthouseDeviceType::LighthouseV2 => {
            (LIGHTHOUSE_V2_PWR_SERVICE, LIGHTHOUSE_V2_PWR_CHARACTERISTIC)
        }
    };
    // Discovery leaves out services it could not enumerate, so an incomplete cache is dropped
    let service = match device
        .bt_device
        .services()
        .into_iter()
        .find(|service| service.uuid.eq(&service_uuid))
    {
        Some(service) => service,
        None => {
            let _ = device.bt_device.disconnect().await;
            return Err(LighthouseError::ServiceNotFound);
        }
    };
    let characteristic = match service
        .characteristics
        .into_iter()
        .find(|characteristic| characteristic.uuid.eq(&characteristic_uuid))
    {
        Some(characteristic) => characteristic,
        None => {
            let _ = device.bt_device.disconnect().await;
            return Err(LighthouseError::CharacteristicNotFound);
        }
    };
    Ok((device.bt_device, characteristic))
}

async fn map_discovered_device_to_lighthouse_device(d: LighthouseDevice) -> LighthouseDeviceModel {
    let power_state = match LIGHTHOUSE_DEVICE_POWER_STATES
        .lock()
        .await
        .get(&d.id.to_string())
    {
        Some(state) => state.clone(),
        None => LighthousePowerState::Unknown,
    };
    let v1_timeout = LIGHTHOUSE_DEVICE_V1_TIMEOUTS
        .lock()
        .await
        .get(&d.id.to_string())
        .copied();
    let ld = LighthouseDeviceModel {
        id: d.id.to_string(),
        device_name: d.device_name,
        power_state,
        device_type: d.device_type,
        v1_timeout,
    };
    if ld.device_type == LighthouseDeviceType::LighthouseV1 {
        info!("LD: {ld:?}");
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
        let devices_guard = LIGHTHOUSE_DEVICES.lock().await;
        for device in devices_guard.iter() {
            let _ = device.bt_device.disconnect().await;
        }
    }
    // Clear all known devices
    {
        let mut lighthouse_devices_guard = LIGHTHOUSE_DEVICES.lock().await;
        lighthouse_devices_guard.clear();
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
    // Clear all processing devices
    {
        let mut processing_devices_guard = PROCESSING_DEVICES.lock().await;
        processing_devices_guard.clear();
    }
}
