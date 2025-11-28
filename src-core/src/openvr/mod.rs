mod brightness_analog;
mod brightness_overlay;
mod chaperone;
mod colortemp_analog;
pub mod commands;
mod devices;
mod framelimiter;
mod gesture_detector;
mod models;
mod sleep_detector;
mod supersampling;

use crate::{
    globals::STEAM_APP_KEY,
    openvr::models::{OpenVRAction, OpenVRActionSet},
    utils::send_event,
};
use chrono::{DateTime, Utc};
use gesture_detector::GestureDetector;
use log::{error, info};
use models::OpenVRStatus;
use openvr::input::VRActiveActionSet;
use sleep_detector::SleepDetector;
use std::{
    sync::{Arc, LazyLock},
    time::Duration,
};
use substring::Substring;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct OpenVRInputContext {
    pub actions: Vec<OpenVRAction>,
    pub action_sets: Vec<OpenVRActionSet>,
    pub active_sets: Vec<VRActiveActionSet>,
}

pub static OVR_CONTEXT: LazyLock<Mutex<Arc<Option<openvr::Context>>>> = LazyLock::new(Default::default);
static OVR_STATUS: LazyLock<Mutex<OpenVRStatus>> =
    LazyLock::new(|| Mutex::new(OpenVRStatus::Inactive));
static OVR_ACTIVE: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));
pub static OVR_INPUT_CONTEXT: LazyLock<Mutex<OpenVRInputContext>> = LazyLock::new(Mutex::default);
static OVR_INIT_DELAY_FIX: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));

pub async fn init() {
    *OVR_ACTIVE.lock().await = true;
    tokio::spawn(task());
}

pub async fn task() {
    // Task state
    let mut ovr_active = false;
    let mut ovr_next_init = DateTime::from_timestamp_millis(0).unwrap();

    // Main Loop
    'ovr_loop: loop {
        tokio::time::sleep(Duration::from_millis(32)).await;
        if *OVR_ACTIVE.lock().await {
            // If we're not active, try to initialize OpenVR
            if OVR_CONTEXT.lock().await.is_none() {
                // Stop if we cannot yet (re)initialize OpenVR
                if (Utc::now() - ovr_next_init).num_milliseconds() <= 0 {
                    continue;
                }
                // If we need to reinitialize OpenVR after this, wait at least 3 seconds
                ovr_next_init = Utc::now() + chrono::Duration::seconds(3);
                // Check if SteamVR is running, snd stop initializing if it's not.
                if !crate::utils::is_process_active("vrmonitor.exe", false).await {
                    update_status(OpenVRStatus::Inactive).await;
                    continue;
                }
                // Update the status
                update_status(OpenVRStatus::Initializing).await;
                // If we need to delay the initialization, do so
                if *OVR_INIT_DELAY_FIX.lock().await {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                } else {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                // Try to initialize OpenVR
                let ctx = Arc::new(
                    match unsafe { openvr::init(openvr::ApplicationType::Background) } {
                        Ok(ctx) => Some(ctx),
                        Err(_) => None,
                    },
                );
                // If we failed, continue to try again later
                if ctx.is_none() {
                    *OVR_CONTEXT.lock().await = None.into();
                    continue;
                }
                // Set the context on the module state
                *OVR_CONTEXT.lock().await = ctx.clone();
                // Initialize submodules
                if brightness_overlay::on_ovr_init(ctx.as_ref().as_ref().unwrap())
                    .await
                    .is_err()
                {
                    *OVR_CONTEXT.lock().await = None.into();
                    continue;
                }
                // We've successfully initialized OpenVR
                info!("[Core] OpenVR Initialized");
                ovr_active = true;
                update_status(OpenVRStatus::Initialized).await;
                // (Un)register manifest if needed
                {
                    let ctx = OVR_CONTEXT.lock().await;
                    let mut applications = ctx.as_ref().as_ref().unwrap().application().unwrap();

                    let manifest_path_buf =
                        std::fs::canonicalize("resources/manifest.vrmanifest").unwrap();
                    let manifest_path: &std::path::Path = manifest_path_buf.as_ref();

                    let is_installed = match applications.is_application_installed(STEAM_APP_KEY) {
                        Ok(value) => Some(value),
                        Err(e) => {
                            error!(
                                "[Core] Failed to check if VR manifest is registered: {:#?}",
                                e
                            );
                            None
                        }
                    };
                    let install_for_flavours = [
                        crate::flavour::BuildFlavour::Standalone,
                        crate::flavour::BuildFlavour::Dev,
                    ];
                    let should_install_for_flavour =
                        install_for_flavours.contains(&crate::flavour::BUILD_FLAVOUR);

                    // Unregister if needed
                    if is_installed.is_some_and(|v| v) && !should_install_for_flavour {
                        match applications.remove_application_manifest(manifest_path) {
                            Ok(_) => {
                                info!(
                                    "[Core] Steam app manifest unregistered, as it's not required for this build flavour ({}) ({})",
                                    STEAM_APP_KEY,
                                    manifest_path.display()
                                );
                            }
                            Err(e) => {
                                error!(
                                    "[Core] Failed to unregister VR manifest: {:#?}",
                                    e
                                );
                            }
                        };
                    };

                    // Register if needed
                    if is_installed.is_some_and(|v| !v) && should_install_for_flavour {
                        if let Err(e) = applications.add_application_manifest(manifest_path, false)
                        {
                            error!(
                                "[Core] Failed to register VR manifest: {:#?}",
                                e
                            );
                        } else {
                            info!("[Core] Steam app manifest registered ({})", STEAM_APP_KEY)
                        }
                    }
                }
                // Set up SteamVR Input
                let mut actions = vec![];
                let mut action_sets = vec![];
                let mut active_sets = vec![];
                {
                    let ctx = OVR_CONTEXT.lock().await;
                    let mut input = ctx.as_ref().as_ref().unwrap().input().unwrap();
                    // Register action manifest
                    info!("[Core] Registering Action Manifest");
                    let manifest_path_buf =
                        std::fs::canonicalize("resources/input/action_manifest.json").unwrap();
                    let manifest_path: &std::path::Path = manifest_path_buf.as_ref();
                    if let Err(e) = input.set_action_manifest(manifest_path) {
                        error!(
                            "[Core] Failed to register action manifest: {:#?}",
                            e
                        );
                    } else {
                        // Get action handles
                        for action in vec![
                            "/actions/main/in/OpenOverlay",
                            "/actions/main/in/MuteMicrophone",
                            "/actions/hidden/in/IndicatePresence",
                            "/actions/hidden/in/OverlayInteract",
                        ]
                        .into_iter()
                        {
                            let handle = match input.get_action_handle(action) {
                                Ok(value) => value,
                                Err(error) => {
                                    error!(
                                        "[Core] Failed get action handle: {:?}",
                                        error
                                    );
                                    continue;
                                }
                            };
                            actions.push(OpenVRAction {
                                name: action.to_string(),
                                handle,
                            });
                        }
                        // Get action set handles
                        for action_set in vec!["/actions/main", "/actions/hidden"].into_iter() {
                            let handle = match input.get_action_set_handle(action_set) {
                                Ok(value) => value,
                                Err(error) => {
                                    error!(
                                        "[Core] Failed get action set handle: {:?}",
                                        error
                                    );
                                    continue;
                                }
                            };
                            active_sets.push(VRActiveActionSet(openvr_sys::VRActiveActionSet_t {
                                ulActionSet: handle.0,
                                ulRestrictedToDevice: openvr_sys::k_ulInvalidInputValueHandle,
                                ulSecondaryActionSet: 0,
                                unPadding: 0,
                                nPriority: 0,
                            }));
                            action_sets.push(OpenVRActionSet {
                                name: action_set.to_string(),
                                handle,
                            });
                        }
                    }
                }
                {
                    let mut input_ctx = OVR_INPUT_CONTEXT.lock().await;
                    input_ctx.actions.clear();
                    for item in actions.drain(..) {
                        input_ctx.actions.push(item);
                    }
                    input_ctx.action_sets.clear();
                    for item in action_sets.drain(..) {
                        input_ctx.action_sets.push(item);
                    }
                    input_ctx.active_sets.clear();
                    for item in active_sets.drain(..) {
                        input_ctx.active_sets.push(item);
                    }
                }
            }
            // Process tick
            devices::on_ovr_tick().await;
            // Poll for events
            loop {
                let event = {
                    let ctx = OVR_CONTEXT.lock().await;
                    let system = ctx.as_ref().as_ref().unwrap().system().unwrap();
                    let event = system.poll_next_event();
                    if event.is_none() {
                        break;
                    }
                    event.unwrap()
                };
                // Handle Quit event
                if let openvr::system::Event::Quit(_)  =event.event {
                    info!("[Core] OpenVR is Quitting. Shutting down OpenVR module");
                    ovr_active = false;
                    update_status(OpenVRStatus::Inactive).await;
                    // Shutdown modules
                    brightness_overlay::on_ovr_quit().await;
                    // Shutdown OpenVR
                    unsafe {
                        OVR_CONTEXT.lock().await.as_ref().as_ref().unwrap().shutdown();
                    }
                    *OVR_CONTEXT.lock().await = None.into();
                    // Schedule next initialization attempt
                    ovr_next_init = Utc::now() + chrono::Duration::seconds(5);
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
                   OVR_CONTEXT.lock().await.as_ref().as_ref().unwrap().shutdown();
                }
                *OVR_CONTEXT.lock().await = None.into();
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
