use btleplug::api::{Central, CentralEvent, Manager as _, Peripheral, ScanFilter};
use btleplug::platform::{Adapter, Manager, PeripheralId};
use futures::{Stream, StreamExt};
use log::{error, info, warn};
use tokio::sync::Mutex;
use uuid::Uuid;


#[tauri::command]
pub async fn lighthouse_scan_devices() -> Result<(), String> {
    // Stop quietly if we are already scanning
    if *BT_SCANNING.lock().await {
        return Ok(());
    }
    // Start scanning
    if let Some(central) = BT_CENTRAL.lock().await.as_ref() {
        if let Err(e) = central.start_scan(ScanFilter::default()).await {
            error!("[Core] Could not start bluetooth scan: {}", e);
            return Err("BLUETOOTH_ERROR".into());
        }
        *BT_SCANNING.lock().await = true;
        info!("[Core] Started scanning for lighthouse devices");
    } else {
        error!("[Core] Tried scanning for lighthouse devices while no bluetooth adapter was initialized");
        return Err("BLUETOOTH_UNINITIALIZED".into());
    }
    // Wait 10 seconds
    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    // Stop scanning
    if let Some(central) = BT_CENTRAL.lock().await.as_ref() {
        central.stop_scan().await.unwrap();
        info!("[Core] Stopped scanning for lighthouse devices");
    }
    *BT_SCANNING.lock().await = false;
    Ok(())
}
