use super::OVR_CONTEXT;
use log::error;
use ovr_overlay as ovr;
use tokio::sync::Mutex;

lazy_static! {
    static ref OVERLAY_HANDLE: Mutex<Option<ovr_overlay::overlay::OverlayHandle>> =
        Default::default();
    static ref BRIGHTNESS: Mutex<f64> = Mutex::new(1.0);
}

pub async fn on_ovr_init(context: &ovr::Context) -> Result<(), String> {
    // Dispose of any existing overlay
    *OVERLAY_HANDLE.lock().await = None;
    // Create the overlay
    let overlay_handle = match create_overlay(&context).await {
        Ok(handle) => handle,
        Err(_) => return Err("Failed to create overlay".to_string()),
    };
    // Save the handle
    *OVERLAY_HANDLE.lock().await = Some(overlay_handle);
    Ok(())
}

pub async fn on_ovr_quit() {
    *OVERLAY_HANDLE.lock().await = None;
}

pub async fn set_brightness(brightness: f64, perceived_brightness_adjustment_gamma: Option<f64>) {
    // Clamp brightness between 0.0 and 1.0
    let mut brightness = brightness.max(0.0).min(1.0);
    // Adjust the brightness value for perceived brightness
    if let Some(gamma) = perceived_brightness_adjustment_gamma {
        brightness = adjust_for_perceived_brightness(brightness, gamma);
    }
    // Convert to alpha value
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
    if let Err(e) = manager.set_opacity(*overlay_handle, alpha as f32) {
        error!("[Core] Failed to set overlay opacity: {}", e);
    };
}

async fn create_overlay(
    context: &ovr_overlay::Context,
) -> Result<ovr_overlay::overlay::OverlayHandle, ()> {
    // Get the manager
    let mut manager = context.overlay_mngr();
    // Create the overlay
    let result = manager.create_overlay(
        "co.raphii.oyasumi:BrightnessOverlay",
        "OyasumiVR Brightness Overlay",
    );
    let overlay: ovr_overlay::overlay::OverlayHandle = match result {
        Ok(handle) => handle,
        Err(_) => return Err(()),
    };
    // Set overlay image data (1 black pixel)
    if let Err(e) = manager.set_raw_data(overlay, &[0x00, 0x00, 0x00, 0xff], 1, 1, 4) {
        error!("[Core] Failed to set overlay image data: {}", e);
        return Err(());
    }
    // Transform the overlay
    let transformation_matrix =
        ovr_overlay::pose::Matrix3x4([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., -0.15]]);
    if let Err(e) = manager.set_transform_tracked_device_relative(
        overlay,
        ovr_overlay::TrackedDeviceIndex::new(0).unwrap(), // HMD is always at 0
        &transformation_matrix,
    ) {
        error!("[Core] Failed to set overlay transform: {}", e);
        return Err(());
    }
    // Set overlay properties
    if let Err(e) = manager.set_sort_order(overlay, 200) {
        error!("[Core] Failed to set overlay sort order: {}", e);
        return Err(());
    }
    if let Err(e) = manager.set_width(overlay, 1.) {
        error!("[Core] Failed to set overlay width: {}", e);
        return Err(());
    }
    let brightness = BRIGHTNESS.lock().await;
    let alpha = 1.0 - *brightness;
    if let Err(e) = manager.set_opacity(overlay, alpha as f32) {
        error!("[Core] Failed to set overlay opacity: {}", e);
        return Err(());
    }
    // Show overlay
    if let Err(e) = manager.set_visibility(overlay, true) {
        error!("[Core] Failed to set overlay visibility: {}", e);
        return Err(());
    }
    // Return overlay
    Ok(overlay)
}

fn adjust_for_perceived_brightness(linear_percent: f64, gamma: f64) -> f64 {
    linear_percent.powf(1.0 / gamma)
}
