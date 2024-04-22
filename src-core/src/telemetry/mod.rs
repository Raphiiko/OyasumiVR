use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use log::info;
use serde_json::json;
use tauri_plugin_aptabase::EventTracker;
use tokio::{sync::Mutex, time::Instant};

use crate::BUILD_FLAVOUR;

pub mod commands;

lazy_static! {
    pub static ref TELEMETRY_INITIALIZED: Mutex<bool> = Mutex::new(false);
    pub static ref TELEMETRY_ENABLED: AtomicBool = AtomicBool::new(false);
}

pub async fn init_telemetry(handle: &tauri::AppHandle) {
    *TELEMETRY_INITIALIZED.lock().await = true;
    if !TELEMETRY_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    info!("[Core] Initializing telemetry");
    let flavour = serde_json::to_string(&BUILD_FLAVOUR)
        .unwrap()
        .to_uppercase();
    handle.track_event("app_started", Some(json!({ "flavour": flavour.clone() })));
    // Send heartbeats roughly every 24 hours (to keep the current session alive)
    tokio::task::spawn(async {
        let mut start_time = Instant::now();
        let one_hour = Duration::from_secs((3600 * 24) - 30);
        loop {
            let elapsed = start_time.elapsed();
            if elapsed >= one_hour {
                start_time = Instant::now();
                if TELEMETRY_ENABLED.load(Ordering::Relaxed) {
                    let handle = crate::globals::TAURI_APP_HANDLE.lock().await;
                    if let Some(handle) = handle.as_ref() {
                        handle.track_event("app_heartbeat", None);
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(5)).await // Check every second (adjust as needed)
        }
    });
}
