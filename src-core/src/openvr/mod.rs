mod brightness_analog;
mod brightness_overlay;
mod chaperone;
pub mod commands;
mod devices;
mod gesture_detector;
mod models;
mod sleep_detector;
mod supersampling;

use crate::utils::send_event;
use chrono::{naive::NaiveDateTime, Utc};
use gesture_detector::GestureDetector;
use log::info;
use models::OpenVRStatus;
use ovr_overlay as ovr;
use sleep_detector::SleepDetector;
use std::time::Duration;
use substring::Substring;
use tokio::sync::Mutex;

lazy_static! {
    static ref OVR_CONTEXT: Mutex<Option<ovr::Context>> = Default::default();
    static ref OVR_STATUS: Mutex<OpenVRStatus> = Mutex::new(OpenVRStatus::Inactive);
    static ref OVR_ACTIVE: Mutex<bool> = Mutex::new(false);
}

pub async fn init() {
    *OVR_ACTIVE.lock().await = true;
    tokio::spawn(task());
}

pub async fn task() {
    // Task state
    let mut ovr_active = false;
    let mut ovr_next_init = NaiveDateTime::from_timestamp_millis(0).unwrap();

    // Main Loop
    'ovr_loop: loop {
        tokio::time::sleep(Duration::from_millis(32)).await;
        if *OVR_ACTIVE.lock().await {
            // If we're not active, try to initialize OpenVR
            if OVR_CONTEXT.lock().await.is_none() {
                // Stop if we cannot yet (re)initialize OpenVR
                if (Utc::now().naive_utc() - ovr_next_init).num_milliseconds() <= 0 {
                    continue;
                }
                // If we need to reinitialize OpenVR after this, wait at least 3 seconds
                ovr_next_init = Utc::now().naive_utc() + chrono::Duration::seconds(3);
                // Check if SteamVR is running, snd stop initializing if it's not.
                if !crate::utils::is_process_active("vrmonitor.exe").await {
                    update_status(OpenVRStatus::Inactive).await;
                    continue;
                }
                // Update the status
                update_status(OpenVRStatus::Initializing).await;
                // Try to initialize OpenVR
                let ctx = match ovr::Context::init(
                    ovr::sys::EVRApplicationType::VRApplication_Background,
                ) {
                    Ok(ctx) => Some(ctx),
                    Err(_) => None,
                };
                // If we failed, continue to try again later
                if ctx.is_none() {
                    *OVR_CONTEXT.lock().await = None;
                    continue;
                }
                // Set the context on the module state
                *OVR_CONTEXT.lock().await = ctx.clone();
                // Initialize submodules
                if brightness_overlay::on_ovr_init(&ctx.unwrap())
                    .await
                    .is_err()
                {
                    *OVR_CONTEXT.lock().await = None;
                    continue;
                }
                // We've successfully initialized OpenVR
                info!("[Core] OpenVR Initialized");
                ovr_active = true;
                update_status(OpenVRStatus::Initialized).await;
                // Register manifest if needed
                {
                    let ctx = OVR_CONTEXT.lock().await;
                    let mut applications = ctx.as_ref().unwrap().applications_mngr();
                    if let Ok(r) = applications.is_application_installed("steam.overlay.2538150") {
                        if !r {
                            info!("[Core] Registering VR Manifest");
                            let manifest_path_buf =
                                std::fs::canonicalize("resources/manifest.vrmanifest").unwrap();
                            let manifest_path: &std::path::Path = manifest_path_buf.as_ref();
                            let _ = applications.add_application_manifest(manifest_path, false);
                        }
                    }
                }
            }
            // Process tick
            devices::on_ovr_tick().await;
            // Poll for events
            loop {
                let event = {
                    let ctx = OVR_CONTEXT.lock().await;
                    let mut system = ctx.as_ref().unwrap().system_mngr();
                    let event = system.poll_next_event();
                    if event.is_none() {
                        break;
                    }
                    event.unwrap()
                };
                // Handle Quit event
                if event.event_type == ovr::sys::EVREventType::VREvent_Quit {
                    info!("[Core] OpenVR is Quitting. Shutting down OpenVR module");
                    ovr_active = false;
                    update_status(OpenVRStatus::Inactive).await;
                    // Shutdown modules
                    brightness_overlay::on_ovr_quit().await;
                    // Shutdown OpenVR
                    unsafe {
                        ovr::sys::VR_Shutdown();
                    }
                    *OVR_CONTEXT.lock().await = None;
                    // Schedule next initialization attempt
                    ovr_next_init = Utc::now().naive_utc() + chrono::Duration::seconds(5);
                    continue 'ovr_loop;
                }
                // Handle other events
                devices::on_ovr_event(event).await;
            }
        } else if ovr_active {
            ovr_active = false;
            info!("[Core] Shutting down OpenVR module");
            update_status(OpenVRStatus::Inactive).await;
            let ctx = OVR_CONTEXT.lock().await;
            if ctx.is_some() {
                drop(ctx);
                // Shutdown modules
                brightness_overlay::on_ovr_quit().await;
                // Shutdown OpenVR
                unsafe {
                    ovr::sys::VR_Shutdown();
                }
                *OVR_CONTEXT.lock().await = None;
            }
        }
    }
}

async fn update_status(new_status: OpenVRStatus) {
    let mut status = OVR_STATUS.lock().await;
    *status = new_status.clone();
    let status_str = serde_json::to_string(&new_status).unwrap();
    send_event(
        "OVR_STATUS_UPDATE",
        status_str.substring(1, status_str.len() - 1).to_string(),
    )
        .await;
}
