pub mod commands;

use chrono::{NaiveDateTime, Utc};
use std::time::Duration;
use tokio::sync::Mutex;

lazy_static! {
    static ref ACTIVE: Mutex<bool> = Mutex::new(false);
    static ref OVERLAY_HANDLE: Mutex<Option<ovr_overlay::overlay::OverlayHandle>> =
        Default::default();
    static ref OVR_CONTEXT: Mutex<Option<ovr_overlay::Context>> = Default::default();
    static ref BRIGHTNESS: Mutex<f32> = Mutex::new(1.0);
}

pub async fn init() {
    if *ACTIVE.lock().await {
        return;
    }
    *ACTIVE.lock().await = true;
    tokio::spawn(main_task());
}

pub async fn set_brightness(brightness: f32) {
    // Clamp brightness between 0.0 and 1.0
    let brightness = brightness.max(0.0).min(1.0);
    let alpha = 1.0 - brightness;
    // Store the brightness
    *BRIGHTNESS.lock().await = brightness;
    // Get the context
    let mut context_guard = OVR_CONTEXT.lock().await;
    let context = match context_guard.as_mut() {
        Some(manager) => manager,
        None => return,
    };
    // Get the manager
    let mut manager = context.overlay_mngr();
    // Get the overlay handle
    let overlay_handle_guard = OVERLAY_HANDLE.lock().await;
    let overlay_handle = match overlay_handle_guard.as_ref() {
        Some(handle) => handle,
        None => return,
    };
    // Set the brightness
    if let Err(e) = manager.set_opacity(*overlay_handle, alpha) {
        eprintln!("[Core] Failed to set overlay opacity: {}", e);
    };
}

async fn main_task() {
    let mut ovr_active = false;
    let mut ovr_next_init = NaiveDateTime::from_timestamp_millis(0).unwrap();

    'ovr_loop: loop {
        tokio::time::sleep(Duration::from_millis(32)).await;
        let mut ovr_context = OVR_CONTEXT.lock().await;
        let state_active = ACTIVE.lock().await;
        if *state_active {
            drop(state_active);
            if ovr_context.is_none() {
                // Stop if we cannot yet (re)initialize OpenVR
                if (Utc::now().naive_utc() - ovr_next_init).num_milliseconds() <= 0 {
                    continue;
                }
                // If we need to reinitialize OpenVR after this, wait at least 3 seconds
                ovr_next_init = Utc::now().naive_utc() + chrono::Duration::seconds(3);
                // Check if SteamVR is running, and stop initializing if it's not.
                // if !crate::utils::is_process_active("vrmonitor.exe").await {
                //     continue;
                // }
                // Attempt initializing OpenVR
                *ovr_context = match ovr_overlay::Context::init(
                    ovr_overlay::sys::EVRApplicationType::VRApplication_Background,
                ) {
                    Ok(ctx) => Some(ctx),
                    Err(_) => None,
                };
                // If we failed, continue to try again later
                if ovr_context.is_none() {
                    continue;
                }
                let context = ovr_context.as_ref().unwrap();
                // Create the overlay
                let overlay_handle = match create_overlay(&context).await {
                    Ok(handle) => Some(handle),
                    Err(_) => None,
                };
                *OVERLAY_HANDLE.lock().await = overlay_handle;
                // If we failed, continue to try again later
                if overlay_handle.is_none() {
                    continue;
                }
                // Success!
                println!("[Core] OVR brightness overlay initialized");
                ovr_active = true;
            }
            // Get the system reference
            let mut system = ovr_context.as_ref().unwrap().system_mngr();
            // Poll events
            while let Some(e) = system.poll_next_event() {
                // Handle Quit event
                match e.event_type {
                    ovr_overlay::sys::EVREventType::VREvent_Quit => {
                        // Shutdown OpenVR
                        println!("[Core] OpenVR is Quitting. Disabling OVR brightness overlay");
                        ovr_active = false;
                        *OVERLAY_HANDLE.lock().await = None;
                        unsafe {
                            ovr_overlay::sys::VR_Shutdown();
                        }
                        *ovr_context = None;
                        // Schedule next initialization attempt
                        ovr_next_init = Utc::now().naive_utc() + chrono::Duration::seconds(5);
                        continue 'ovr_loop;
                    }
                    _ => {}
                }
            }
        } else if ovr_active {
            ovr_active = false;
            println!("[Core] Disabling OVR brightness overlay");
            if let Some(_) = ovr_context.as_ref() {
                *OVERLAY_HANDLE.lock().await = None;
                unsafe {
                    ovr_overlay::sys::VR_Shutdown();
                }
                *ovr_context = None;
            }
        }
    }
}

async fn create_overlay(
    context: &ovr_overlay::Context,
) -> Result<ovr_overlay::overlay::OverlayHandle, ()> {
    // Get the manager
    let mut manager = context.overlay_mngr();
    // Create the overlay
    let result = manager.create_overlay("OYASUMI_OVR_BRIGHTNESS", "Oyasumi Brightness Overlay");
    let overlay: ovr_overlay::overlay::OverlayHandle = match result {
        Ok(handle) => handle,
        Err(_) => return Err(()),
    };
    // Set overlay image data (1 black pixel)
    if let Err(e) = manager.set_raw_data(overlay, &[0x00, 0x00, 0x00, 0xff], 1, 1, 4) {
        eprintln!("[Core] Failed to set overlay image data: {}", e);
        return Err(());
    }
    // Transform the overlay
    let transformation_matrix =
        ovr_overlay::pose::Matrix3x4([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., -0.25]]);
    if let Err(e) = manager.set_transform_tracked_device_relative(
        overlay,
        ovr_overlay::TrackedDeviceIndex::new(0).unwrap(), // HMD is always at 0
        &transformation_matrix,
    ) {
        eprintln!("[Core] Failed to set overlay transform: {}", e);
        return Err(());
    }
    // Set overlay properties
    if let Err(e) = manager.set_width(overlay, 1.) {
        eprintln!("[Core] Failed to set overlay width: {}", e);
        return Err(());
    }
    if let Err(e) = manager.set_curvature(overlay, 0.5) {
        eprintln!("[Core] Failed to set overlay curvature: {}", e);
        return Err(());
    }
    let brightness = BRIGHTNESS.lock().await;
    let alpha = 1.0 - *brightness;
    if let Err(e) = manager.set_opacity(overlay, alpha) {
        eprintln!("[Core] Failed to set overlay opacity: {}", e);
        return Err(());
    }
    // Show overlay
    if let Err(e) = manager.set_visibility(overlay, true) {
        eprintln!("[Core] Failed to set overlay visibility: {}", e);
        return Err(());
    }
    // Return overlay
    Ok(overlay)
}
