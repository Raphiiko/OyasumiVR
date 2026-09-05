pub mod commands;
pub mod models;

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, LazyLock,
    },
    time::{Duration, Instant},
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
use tokio::{
    sync::Mutex,
    time::{sleep, timeout},
};
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
static MANAGER: LazyLock<Mutex<Option<Manager>>> = LazyLock::new(Mutex::default);
static STATUS: LazyLock<Mutex<LighthouseStatus>> =
    LazyLock::new(|| Mutex::new(LighthouseStatus::Uninitialized));
static PROCESSING_DEVICES: LazyLock<Mutex<HashSet<PeripheralId>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));
// Per device: consecutive connect failures, and when the last one happened
static CONNECT_BACKOFFS: LazyLock<std::sync::Mutex<HashMap<PeripheralId, (u32, Instant)>>> =
    LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));
static CONNECT_FAILURE_STREAK: AtomicU32 = AtomicU32::new(0);
static LAST_RADIO_RECOVERY: LazyLock<Mutex<Option<Instant>>> = LazyLock::new(|| Mutex::new(None));
static PENDING_RESTORE_FILE_LOCK: LazyLock<std::sync::Mutex<()>> =
    LazyLock::new(|| std::sync::Mutex::new(()));
static RADIO_RECOVERY_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_RETRY_COOLDOWN: Duration = Duration::from_secs(10);
const CONNECT_BACKOFF_MAX: Duration = Duration::from_secs(300);
// Failing connects to every device at once is the signature of a wedged stack
const RADIO_RECOVERY_THRESHOLD: u32 = 6;
const RADIO_RECOVERY_COOLDOWN: Duration = Duration::from_secs(300);
const RADIO_ON_ATTEMPTS: u32 = 3;
const RADIO_RESTORE_TIMEOUT: Duration = Duration::from_secs(60);
const RADIO_RESTORE_RETRY_COOLDOWN: Duration = Duration::from_secs(30);
const RADIO_ADAPTER_RETRY_COOLDOWN: Duration = Duration::from_secs(5);

pub async fn init() {
    if timeout(RADIO_RESTORE_TIMEOUT, restore_pending_radios())
        .await
        .is_err()
    {
        warn!("[Core] Timed out restoring pending bluetooth radios");
    }
    if pending_restores_remain() {
        tokio::spawn(retry_pending_radio_restores());
    }
    // Initialize adapter
    loop {
        let manager = match Manager::new().await {
            Ok(manager) => manager,
            Err(err) => {
                set_lighthouse_status(LighthouseStatus::AdapterError).await;
                if pending_restores_remain() {
                    warn!("[Core] Failed to initialize the bluetooth manager while restores remain: {err}");
                    sleep(RADIO_ADAPTER_RETRY_COOLDOWN).await;
                    continue;
                }
                error!("[Core] Failed to initialize the bluetooth manager: {err}");
                return;
            }
        };
        match manager.adapters().await {
            Ok(adapters) if !adapters.is_empty() => {
                *MANAGER.lock().await = Some(manager);
                set_lighthouse_status(LighthouseStatus::Ready).await;
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
                return;
            }
            Ok(_) => {
                set_lighthouse_status(LighthouseStatus::NoAdapter).await;
                if pending_restores_remain() {
                    warn!("[Core] No bluetooth adapter was found while restores remain");
                    sleep(RADIO_ADAPTER_RETRY_COOLDOWN).await;
                    continue;
                }
                warn!("[Core] No bluetooth adapter was found. Disabling lighthouse module.");
                return;
            }
            Err(err) => {
                set_lighthouse_status(LighthouseStatus::AdapterError).await;
                if pending_restores_remain() {
                    error!(
                        "[Core] Failed to list the bluetooth adapters while restores remain: {err}"
                    );
                    sleep(RADIO_ADAPTER_RETRY_COOLDOWN).await;
                    continue;
                }
                error!("[Core] Failed to list the bluetooth adapters: {err}");
                return;
            }
        }
    }
}

fn pending_restores_remain() -> bool {
    !matches!(
        read_persisted_pending_restores(),
        Some(pending_ids) if pending_ids.is_empty()
    )
}

async fn retry_pending_radio_restores() {
    loop {
        sleep(RADIO_RESTORE_RETRY_COOLDOWN).await;
        if timeout(RADIO_RESTORE_TIMEOUT, restore_pending_radios())
            .await
            .is_err()
        {
            warn!("[Core] Timed out restoring pending bluetooth radios");
        }
        if !pending_restores_remain() {
            return;
        }
    }
}

/// Every scan needs its own adapter: btleplug registers an advertisement handler per `start_scan`
/// call and never removes it.
async fn scan_adapter() -> Option<Adapter> {
    let manager_guard = MANAGER.lock().await;
    let manager = manager_guard.as_ref()?;
    match manager.adapters().await {
        Ok(adapters) => adapters.into_iter().next(),
        Err(err) => {
            warn!("[Core] Failed to list the bluetooth adapters: {err}");
            None
        }
    }
}

pub async fn start_scan(duration: Duration) {
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
    scan_for_devices(duration).await;
    set_scanning_status(false).await;
}

async fn scan_for_devices(duration: Duration) {
    let adapter = match scan_adapter().await {
        Some(adapter) => adapter,
        None => return,
    };
    // Subscribing after the scan starts would miss the first advertisements
    let mut events = match adapter.events().await {
        Ok(events) => events,
        Err(err) => {
            warn!("[Core] Failed to listen for bluetooth adapter events: {err}");
            return;
        }
    };
    if let Err(err) = adapter.start_scan(ScanFilter::default()).await {
        warn!("[Core] Failed to scan for lighthouse devices: {err}");
        return;
    }
    // Listen for scan results
    let mut timer = Box::pin(sleep(duration));
    loop {
        tokio::select! {
            _ = timer.as_mut() => {
                break;
            }
            event = events.next() => {
                let device_id = match event {
                    Some(CentralEvent::DeviceDiscovered(id)) | Some(CentralEvent::DeviceUpdated(id)) => id,
                    Some(_) => continue,
                    None => break,
                };
                if let Ok(peripheral) = adapter.peripheral(&device_id).await {
                    tokio::spawn(handle_discovered_device(peripheral));
                }
            }
        }
    }
    if let Err(err) = adapter.stop_scan().await {
        warn!("[Core] Failed to stop scanning for lighthouse devices: {err}");
    }
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
    let device_id = device.id();
    if !backoff_elapsed(&device_id) {
        return Err(LighthouseError::ConnectBackoff);
    }
    debug!("[Core] Connecting to lighthouse device: {device_name}");
    // The cached service handles are invalid after a reconnect, so drop them first
    let _ = device.disconnect().await;
    match device.connect_with_timeout(CONNECT_TIMEOUT).await {
        Ok(()) => {
            CONNECT_BACKOFFS.lock().unwrap().remove(&device_id);
            CONNECT_FAILURE_STREAK.store(0, Ordering::Relaxed);
        }
        Err(err) => {
            register_connect_failure(&device_id).await;
            return Err(LighthouseError::FailedToConnect(err));
        }
    }
    if let Err(err) = device.discover_services_with_timeout(CONNECT_TIMEOUT).await {
        // Leaving it connected without services would make every later operation fail
        let _ = device.disconnect().await;
        return Err(LighthouseError::FailedToGetServices(err));
    }
    Ok(())
}

fn connect_backoff_delay(failures: u32) -> Duration {
    let factor = 1u32.checked_shl((failures - 1).min(5)).unwrap_or(u32::MAX);
    CONNECT_RETRY_COOLDOWN
        .saturating_mul(factor)
        .min(CONNECT_BACKOFF_MAX)
}

fn backoff_elapsed(device_id: &PeripheralId) -> bool {
    let backoffs = CONNECT_BACKOFFS.lock().unwrap();
    match backoffs.get(device_id) {
        Some((failures, last_failure)) => {
            last_failure.elapsed() >= connect_backoff_delay(*failures)
        }
        None => true,
    }
}

async fn register_connect_failure(device_id: &PeripheralId) {
    {
        let mut backoffs = CONNECT_BACKOFFS.lock().unwrap();
        let entry = backoffs
            .entry(device_id.clone())
            .or_insert((0, Instant::now()));
        entry.0 += 1;
        entry.1 = Instant::now();
    }
    let streak = CONNECT_FAILURE_STREAK.fetch_add(1, Ordering::Relaxed) + 1;
    if streak < RADIO_RECOVERY_THRESHOLD {
        return;
    }
    CONNECT_FAILURE_STREAK.store(0, Ordering::Relaxed);
    let mut last_recovery = LAST_RADIO_RECOVERY.lock().await;
    if last_recovery.is_some_and(|at| at.elapsed() < RADIO_RECOVERY_COOLDOWN) {
        return;
    }
    *last_recovery = Some(Instant::now());
    drop(last_recovery);
    tokio::task::spawn_blocking(|| {
        let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        else {
            warn!("[Core] Failed to start a runtime to cycle the bluetooth radio");
            return;
        };
        runtime.block_on(async {
            warn!("[Core] Bluetooth connects keep failing while devices are in range, cycling the bluetooth radio to recover");
            if let Err(err) = cycle_bluetooth_radio().await {
                warn!("[Core] Failed to cycle the bluetooth radio: {err}");
            }
        });
    });
}

async fn cycle_bluetooth_radio() -> Result<(), String> {
    let _guard = RADIO_RECOVERY_LOCK.lock().await;
    request_radio_access().await?;
    let listing = list_bluetooth_radios().await?;
    let enumeration_complete = listing.complete;
    let radios = listing.radios;
    let pending_ids = read_persisted_pending_restores()
        .ok_or_else(|| String::from("failed to read pending bluetooth radio restores"))?;
    let mut cycle_results = Vec::new();
    for radio in &radios {
        cycle_results.push(cycle_radio(radio, &pending_ids).await);
    }
    let restored_ids = cycle_results
        .iter()
        .filter(|result| result.restored)
        .filter_map(|result| result.id.clone())
        .collect::<Vec<_>>();
    for id in restored_ids {
        if !clear_persisted_pending_restore(&id) {
            if let Some(result) = cycle_results
                .iter_mut()
                .find(|result| result.id.as_deref() == Some(id.as_str()))
            {
                result.error = Some(format!(
                    "failed to clear the pending restore of the '{id}' radio"
                ));
            }
        }
    }
    let mut failures = cycle_results
        .into_iter()
        .filter_map(|result| result.error)
        .collect::<Vec<_>>();
    if !enumeration_complete {
        failures.push(String::from("bluetooth radio enumeration was incomplete"));
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

struct RadioCycleResult {
    id: Option<String>,
    error: Option<String>,
    restored: bool,
}

struct BluetoothRadioListing {
    radios: Vec<BluetoothRadio>,
    complete: bool,
}

struct BluetoothRadio {
    id: String,
    name: String,
    radio: windows::Devices::Radios::Radio,
}

async fn request_radio_access() -> Result<(), String> {
    use windows::Devices::Radios::{Radio, RadioAccessStatus};

    let access = Radio::RequestAccessAsync()
        .map_err(|e| e.to_string())?
        .await
        .map_err(|e| e.to_string())?;
    if access == RadioAccessStatus::Allowed {
        Ok(())
    } else {
        Err(format!("radio access was refused ({access:?})"))
    }
}

async fn list_bluetooth_radios() -> Result<BluetoothRadioListing, String> {
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Devices::Radios::{Radio, RadioKind};

    let selector = Radio::GetDeviceSelector().map_err(|e| e.to_string())?;
    let devices = DeviceInformation::FindAllAsyncAqsFilter(&selector)
        .map_err(|e| e.to_string())?
        .await
        .map_err(|e| e.to_string())?;
    let count = devices.Size().map_err(|e| e.to_string())?;
    let mut radios = Vec::new();
    let mut complete = true;
    for index in 0..count {
        let device = match devices.GetAt(index) {
            Ok(device) => device,
            Err(err) => {
                warn!("[Core] Failed to inspect a radio while listing bluetooth radios: {err}");
                complete = false;
                continue;
            }
        };
        let id = match device.Id() {
            Ok(id) => id,
            Err(err) => {
                warn!("[Core] Failed to read a radio device id: {err}");
                complete = false;
                continue;
            }
        };
        let operation = match Radio::FromIdAsync(&id) {
            Ok(operation) => operation,
            Err(err) => {
                warn!("[Core] Failed to open a radio by device id: {err}");
                complete = false;
                continue;
            }
        };
        let radio = match operation.await {
            Ok(radio) => radio,
            Err(err) => {
                warn!("[Core] Failed to open a radio by device id: {err}");
                complete = false;
                continue;
            }
        };
        let kind = match radio.Kind() {
            Ok(kind) => kind,
            Err(err) => {
                warn!("[Core] Failed to inspect an opened radio: {err}");
                complete = false;
                continue;
            }
        };
        if kind != RadioKind::Bluetooth {
            continue;
        }
        radios.push(BluetoothRadio {
            id: id.to_string(),
            name: radio_name(&radio),
            radio,
        });
    }
    Ok(BluetoothRadioListing { radios, complete })
}

async fn cycle_radio(radio: &BluetoothRadio, pending_ids: &[String]) -> RadioCycleResult {
    use windows::Devices::Radios::{RadioAccessStatus, RadioState};

    let BluetoothRadio { id, name, radio } = radio;
    let cycle_error = |error: Option<String>| RadioCycleResult {
        id: Some(id.clone()),
        error,
        restored: false,
    };
    if pending_ids.contains(id) {
        warn!("[Core] Turning the '{name}' radio back on after a failed recovery");
        if let Err(err) = restore_radio_on(radio).await {
            persist_pending_restore(id);
            return cycle_error(Some(format!("the '{name}' radio {err}")));
        }
    }
    match radio.State() {
        Ok(RadioState::On) => {}
        Ok(RadioState::Off | RadioState::Disabled) => return cycle_error(None),
        Ok(RadioState::Unknown) => {
            warn!("[Core] The '{name}' radio reports an unknown state, cycling it")
        }
        Ok(state) => {
            warn!("[Core] The '{name}' radio reports an unrecognized state ({state:?}), cycling it")
        }
        Err(err) => {
            return cycle_error(Some(format!(
                "failed to read the state of the '{name}' radio: {err}"
            )));
        }
    }
    let probe = match radio.SetStateAsync(RadioState::On) {
        Ok(operation) => operation.await.map_err(|e| e.to_string()),
        Err(err) => Err(err.to_string()),
    };
    let probe = match probe {
        Ok(probe) => probe,
        Err(err) => return cycle_error(Some(err)),
    };
    if probe != RadioAccessStatus::Allowed {
        return cycle_error(Some(format!(
            "turning the '{name}' radio back on was refused before cycling ({probe:?})"
        )));
    }
    if !persist_pending_restore(id) {
        return cycle_error(Some(format!(
            "failed to record the pending restore of the '{name}' radio"
        )));
    }
    let status = match radio.SetStateAsync(RadioState::Off) {
        Ok(operation) => operation.await.map_err(|e| e.to_string()),
        Err(err) => Err(err.to_string()),
    };
    let status = match status {
        Ok(status) => status,
        Err(err) => return cycle_error(Some(err)),
    };
    if status != RadioAccessStatus::Allowed {
        return cycle_error(Some(format!(
            "turning the '{name}' radio off was refused ({status:?})"
        )));
    }
    sleep(Duration::from_secs(3)).await;
    match radio.State() {
        Ok(RadioState::Off) => {}
        Ok(state) => warn!(
            "[Core] The '{name}' radio still reports {state:?} after being turned off, restoring it"
        ),
        Err(err) => {
            warn!("[Core] Failed to read the '{name}' radio state after turning it off: {err}")
        }
    }
    if let Err(err) = restore_radio_on(radio).await {
        return cycle_error(Some(format!("the '{name}' radio {err}")));
    }
    RadioCycleResult {
        id: Some(id.clone()),
        error: None,
        restored: true,
    }
}

fn radio_name(radio: &windows::Devices::Radios::Radio) -> String {
    radio
        .Name()
        .ok()
        .and_then(|name| {
            let name = name.to_string();
            (!name.is_empty()).then_some(name)
        })
        .unwrap_or_else(|| String::from("bluetooth radio"))
}

fn pending_restore_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("co.raphii.oyasumi").join("pending-radio-restores"))
}

fn normalized_pending_restore_names(names: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    names
        .into_iter()
        .filter(|name| !name.is_empty() && seen.insert(name.clone()))
        .collect()
}

fn read_persisted_pending_restores_from(path: &std::path::Path) -> std::io::Result<Vec<String>> {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    match serde_json::from_str::<Vec<String>>(&contents) {
        Ok(ids) => Ok(normalized_pending_restore_names(ids)),
        Err(err) => {
            warn!("[Core] Failed to parse pending bluetooth radio restores: {err}");
            Ok(Vec::new())
        }
    }
}

fn persist_pending_restore_from(path: &std::path::Path, id: &str) -> bool {
    let Ok(mut ids) = read_persisted_pending_restores_from(path) else {
        return false;
    };
    if ids.iter().any(|pending| pending == id) {
        return true;
    }
    ids.push(id.to_string());
    write_persisted_pending_restores_to(path, &ids)
}

fn clear_persisted_pending_restore_from(path: &std::path::Path, id: &str) -> bool {
    let Ok(mut ids) = read_persisted_pending_restores_from(path) else {
        return false;
    };
    let before = ids.len();
    ids.retain(|pending| pending != id);
    if ids.len() == before {
        return true;
    }
    write_persisted_pending_restores_to(path, &ids)
}

fn write_persisted_pending_restores_to(path: &std::path::Path, names: &[String]) -> bool {
    use std::io::Write;

    let Some(parent) = path.parent() else {
        return false;
    };
    if std::fs::create_dir_all(parent).is_err() {
        return false;
    }
    let Ok(contents) = serde_json::to_vec(&normalized_pending_restore_names(names.to_vec())) else {
        return false;
    };
    let Ok(mut file) = tempfile::NamedTempFile::new_in(parent) else {
        return false;
    };
    if file.write_all(&contents).is_err() || file.as_file().sync_all().is_err() {
        return false;
    }
    file.persist(path).is_ok()
}

fn read_persisted_pending_restores() -> Option<Vec<String>> {
    let path = pending_restore_path()?;
    let _guard = PENDING_RESTORE_FILE_LOCK.lock().unwrap();
    match read_persisted_pending_restores_from(&path) {
        Ok(ids) => Some(ids),
        Err(err) => {
            warn!("[Core] Failed to read pending bluetooth radio restores: {err}");
            None
        }
    }
}

fn persist_pending_restore(name: &str) -> bool {
    let Some(path) = pending_restore_path() else {
        warn!("[Core] Failed to locate the pending bluetooth radio restore file");
        return false;
    };
    let _guard = PENDING_RESTORE_FILE_LOCK.lock().unwrap();
    persist_pending_restore_from(&path, name)
}

fn clear_persisted_pending_restore(id: &str) -> bool {
    let Some(path) = pending_restore_path() else {
        warn!("[Core] Failed to locate the pending bluetooth radio restore file");
        return false;
    };
    let _guard = PENDING_RESTORE_FILE_LOCK.lock().unwrap();
    clear_persisted_pending_restore_from(&path, id)
}

fn retain_persisted_pending_restores_from(
    path: &std::path::Path,
    snapshot: &[String],
    restored_ids: &[String],
) -> bool {
    let Ok(current_ids) = read_persisted_pending_restores_from(path) else {
        return false;
    };
    let ids = current_ids
        .into_iter()
        .filter(|id| {
            !snapshot.iter().any(|pending| pending == id)
                || !restored_ids.iter().any(|restored| restored == id)
        })
        .collect::<Vec<_>>();
    write_persisted_pending_restores_to(path, &ids)
}

fn retain_persisted_pending_restores(snapshot: &[String], restored_ids: &[String]) {
    let Some(path) = pending_restore_path() else {
        return;
    };
    let _guard = PENDING_RESTORE_FILE_LOCK.lock().unwrap();
    if !retain_persisted_pending_restores_from(&path, snapshot, restored_ids) {
        warn!("[Core] Failed to update pending bluetooth radio restores");
    }
}

async fn restore_pending_radios() {
    let _guard = RADIO_RECOVERY_LOCK.lock().await;
    let Some(pending_ids) = read_persisted_pending_restores() else {
        return;
    };
    if pending_ids.is_empty() {
        return;
    }
    if let Err(err) = request_radio_access().await {
        warn!("[Core] Failed to get radio access for pending bluetooth recoveries: {err}");
        return;
    }
    let listing = match list_bluetooth_radios().await {
        Ok(listing) => listing,
        Err(err) => {
            warn!("[Core] Failed to list radios for pending bluetooth recoveries: {err}");
            return;
        }
    };
    let restore_results = join_all(
        listing
            .radios
            .into_iter()
            .filter(|radio| pending_ids.contains(&radio.id))
            .map(|radio| async move {
                let id = radio.id.clone();
                let name = radio.name.clone();
                warn!("[Core] Turning the '{name}' radio back on after a restart");
                let restore = restore_radio_on(&radio.radio).await;
                (id, name, restore)
            }),
    )
    .await;
    let mut seen_ids = Vec::new();
    for (id, name, restore) in restore_results {
        match restore {
            Ok(()) => seen_ids.push(id),
            Err(err) => {
                persist_pending_restore(&id);
                warn!("[Core] Failed to turn the '{name}' radio back on after a restart: {err}");
            }
        }
    }
    let restored_ids = seen_ids;
    retain_persisted_pending_restores(&pending_ids, &restored_ids);
}

async fn restore_radio_on(radio: &windows::Devices::Radios::Radio) -> Result<(), String> {
    use windows::Devices::Radios::{RadioAccessStatus, RadioState};

    for attempt in 1..=RADIO_ON_ATTEMPTS {
        if attempt > 1 {
            sleep(Duration::from_secs(3)).await;
        }
        let operation = match radio.SetStateAsync(RadioState::On) {
            Ok(operation) => operation,
            Err(err) => {
                warn!("[Core] Failed to request turning the bluetooth radio back on (attempt {attempt}/{RADIO_ON_ATTEMPTS}): {err}");
                continue;
            }
        };
        let status = match operation.await {
            Ok(status) => status,
            Err(err) => {
                warn!("[Core] Turning the bluetooth radio back on failed (attempt {attempt}/{RADIO_ON_ATTEMPTS}): {err}");
                continue;
            }
        };
        if status != RadioAccessStatus::Allowed {
            warn!("[Core] Turning the bluetooth radio back on was refused (attempt {attempt}/{RADIO_ON_ATTEMPTS}): {status:?}");
            continue;
        }
        sleep(Duration::from_secs(5)).await;
        match radio.State() {
            Ok(RadioState::On) => return Ok(()),
            Ok(state) => warn!("[Core] The bluetooth radio still reports {state:?} after being turned back on (attempt {attempt}/{RADIO_ON_ATTEMPTS})"),
            Err(err) => warn!("[Core] Failed to read the bluetooth radio state after re-enabling it (attempt {attempt}/{RADIO_ON_ATTEMPTS}): {err}"),
        }
    }
    Err("could not be turned back on".to_string())
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
    CONNECT_BACKOFFS.lock().unwrap().clear();
    CONNECT_FAILURE_STREAK.store(0, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_restore_persistence_round_trips_names() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pending-radio-restores");
        let names = vec![
            String::from("radio"),
            String::from("radio"),
            String::from("new\nline name"),
            String::from(" spaced name "),
        ];

        assert!(write_persisted_pending_restores_to(&path, &names));
        assert_eq!(
            read_persisted_pending_restores_from(&path).unwrap(),
            vec![
                String::from("radio"),
                String::from("new\nline name"),
                String::from(" spaced name ")
            ]
        );

        assert!(write_persisted_pending_restores_to(
            &path,
            &[String::new(), String::from("kept")]
        ));
        assert_eq!(
            read_persisted_pending_restores_from(&path).unwrap(),
            vec![String::from("kept")]
        );

        assert!(write_persisted_pending_restores_to(&path, &[]));
        assert!(read_persisted_pending_restores_from(&path)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn pending_restore_helpers_change_only_existing_ids() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pending-radio-restores");

        assert!(persist_pending_restore_from(&path, "first"));
        assert!(persist_pending_restore_from(&path, "first"));
        assert!(persist_pending_restore_from(&path, "second"));
        assert_eq!(
            read_persisted_pending_restores_from(&path).unwrap(),
            vec![String::from("first"), String::from("second")]
        );

        assert!(clear_persisted_pending_restore_from(&path, "missing"));
        assert_eq!(
            read_persisted_pending_restores_from(&path).unwrap(),
            vec![String::from("first"), String::from("second")]
        );
        assert!(clear_persisted_pending_restore_from(&path, "first"));
        assert_eq!(
            read_persisted_pending_restores_from(&path).unwrap(),
            vec![String::from("second")]
        );
    }

    #[test]
    fn pending_restore_retention_preserves_unrestored_ids() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pending-radio-restores");
        write_persisted_pending_restores_to(
            &path,
            &[
                String::from("restored"),
                String::from("missing"),
                String::from("added-after-snapshot"),
            ],
        );

        assert!(retain_persisted_pending_restores_from(
            &path,
            &[String::from("restored"), String::from("missing"),],
            &[String::from("restored")]
        ));
        assert_eq!(
            read_persisted_pending_restores_from(&path).unwrap(),
            vec![
                String::from("missing"),
                String::from("added-after-snapshot")
            ]
        );
    }

    #[test]
    fn corrupt_pending_restore_file_repairs_on_write() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pending-radio-restores");
        std::fs::write(&path, "not json").unwrap();

        assert!(read_persisted_pending_restores_from(&path)
            .unwrap()
            .is_empty());
        assert!(persist_pending_restore_from(&path, "radio"));
        assert!(clear_persisted_pending_restore_from(&path, "radio"));
        assert!(read_persisted_pending_restores_from(&path)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn connect_backoff_grows_and_caps() {
        assert_eq!(connect_backoff_delay(1), Duration::from_secs(10));
        assert_eq!(connect_backoff_delay(2), Duration::from_secs(20));
        assert_eq!(connect_backoff_delay(3), Duration::from_secs(40));
        assert_eq!(connect_backoff_delay(6), CONNECT_BACKOFF_MAX);
        assert_eq!(connect_backoff_delay(60), CONNECT_BACKOFF_MAX);
    }
}
