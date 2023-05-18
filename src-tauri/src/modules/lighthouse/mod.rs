use btleplug::api::{Central, CentralEvent, Manager as _, Peripheral, ScanFilter};
use btleplug::platform::{Adapter, Manager, PeripheralId};
use futures::{Stream, StreamExt};
use log::{error, info, warn};
use tokio::sync::Mutex;
use uuid::Uuid;

enum BTStatus {
    PreInit,
    InitError,
    NoAdapters,
    AdapterError,
    Ready,
}

lazy_static! {
    static ref LIGHTHOUSE_V2_SERVICE: Uuid =
        Uuid::parse_str("00001523-1212-efde-1523-785feabcd124").expect("Failed to parse UUID");
    static ref LIGHTHOUSE_V2_POWER_CHARACTERISTIC: Uuid =
        Uuid::parse_str("00001525-1212-EFDE-1523-785feabcd124").expect("Failed to parse UUID");
    static ref LIGHTHOUSE_V2_IDENTIFY_CHARACTERISTIC: Uuid =
        Uuid::parse_str("00008421-1212-EFDE-1523-785FEABCD124").expect("Failed to parse UUID");
    static ref LIGHTHOUSE_V2_CHANNEL_CHARACTERISTIC: Uuid =
        Uuid::parse_str("00001524-1212-EFDE-1523-785FEABCD124").expect("Failed to parse UUID");
    static ref BT_MANAGER: Mutex<Option<Manager>> = Default::default();
    static ref BT_CENTRAL: Mutex<Option<Adapter>> = Default::default();
    static ref BT_STATUS: Mutex<BTStatus> = Mutex::new(BTStatus::PreInit);
    static ref BT_SCANNING: Mutex<bool> = Mutex::new(false);
    static ref BT_LIGHTHOUSE_IDS: Mutex<Vec<PeripheralId>> = Mutex::new(Vec::new());
}

async fn handle_bt_events(mut events: std::pin::Pin<Box<dyn Stream<Item = CentralEvent> + Send>>) {
    while let Some(event) = events.next().await {
        match event {
            CentralEvent::DeviceDiscovered(id) => {
                let central_guard = BT_CENTRAL.lock().await;
                let central = match central_guard.as_ref() {
                    Some(central) => central,
                    None => continue,
                };
                let peripheral = match central.peripheral(&id).await {
                    Ok(peripheral) => peripheral,
                    Err(_) => continue,
                };
                let properties = match peripheral.properties().await {
                    Ok(properties) => match properties {
                        Some(properties) => properties,
                        None => continue,
                    },
                    Err(_) => continue,
                };
                // Check if device name starts with LHB-
                if let Some(local_name) = properties.local_name.as_ref() {
                    if !local_name.starts_with("LHB-") {
                        continue;
                    }
                } else {
                    continue;
                }
                // Add to lighthbouse IDS
                let mut lighthouse_ids_guard = BT_LIGHTHOUSE_IDS.lock().await;
                if !lighthouse_ids_guard.contains(&id) {
                    lighthouse_ids_guard.push(id.clone());
                    println!(
                        "Found lighthouse device: {} ({})",
                        properties.local_name.as_ref().unwrap(),
                        id.clone()
                    );
                }
            }
            // CentralEvent::DeviceConnected(id) => {}
            // CentralEvent::DeviceDisconnected(id) => {}
            // CentralEvent::ManufacturerDataAdvertisement {
            //     id,
            //     manufacturer_data,
            // } => {}
            // CentralEvent::ServiceDataAdvertisement { id, service_data } => {}
            // CentralEvent::ServicesAdvertisement { id, services } => {}
            _ => {}
        }
    }
}

pub async fn init_bt() {
    // Initialize manager
    {
        let manager = match Manager::new().await {
            Ok(manager) => manager,
            Err(e) => {
                error!("[Core] Could not initialize bluetooth manager: {}", e);
                *BT_STATUS.lock().await = BTStatus::InitError;
                return;
            }
        };
        *BT_MANAGER.lock().await = Some(manager);
    }
    // Obtain adapter reference
    {
        let manager_guard = BT_MANAGER.lock().await;
        let manager = manager_guard.as_ref().unwrap();

        let adapters = match manager.adapters().await {
            Ok(adapters) => adapters,
            Err(e) => {
                error!("[Core] Could not look for bluetooth adapters: {}", e);
                *BT_MANAGER.lock().await = None;
                *BT_STATUS.lock().await = BTStatus::InitError;
                return;
            }
        };
        if adapters.len() == 0 {
            warn!("[Core] No bluetooth adapters were found");
            *BT_MANAGER.lock().await = None;
            *BT_STATUS.lock().await = BTStatus::NoAdapters;
            return;
        }
        let central = adapters.into_iter().nth(0).unwrap();
        *BT_CENTRAL.lock().await = Some(central);
    }
    // Listen for events
    {
        let central_guard = BT_CENTRAL.lock().await;
        let central = central_guard.as_ref().unwrap();
        let events: std::pin::Pin<Box<dyn Stream<Item = CentralEvent> + Send>> =
            match central.events().await {
                Ok(events) => events,
                Err(e) => {
                    error!("[Core] Could not obtain bluetooth adapter events: {}", e);
                    *BT_MANAGER.lock().await = None;
                    *BT_CENTRAL.lock().await = None;
                    *BT_STATUS.lock().await = BTStatus::AdapterError;
                    return;
                }
            };
        drop(central_guard);
        tokio::spawn(handle_bt_events(events));
    }
    info!("[Core] Initialized bluetooth adapter for lighthouse control");
    *BT_STATUS.lock().await = BTStatus::Ready;
}