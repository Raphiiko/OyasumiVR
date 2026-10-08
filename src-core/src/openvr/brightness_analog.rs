use std::ffi::CStr;
use std::sync::LazyLock;

use super::devices::get_devices;
use super::models::TrackedDeviceClass;
use super::{settings_interface_available, OVR_CONTEXT};
use crate::utils::send_event;
use raphii_openvr_rs as ovr;
use tokio::sync::Mutex;

/// The gain OyasumiVR last wrote or reported, so the settings event of its own write is skipped.
/// Set it only while holding the OpenVR context lock, so it stays in step with SteamVR.
static KNOWN_ANALOG_GAIN: LazyLock<Mutex<Option<f32>>> = LazyLock::new(|| Mutex::new(None));

fn section() -> &'static CStr {
    CStr::from_bytes_with_nul(ovr::raw::k_pch_SteamVR_Section).unwrap()
}

async fn hmd_present() -> bool {
    get_devices()
        .await
        .iter()
        .any(|device| device.class == TrackedDeviceClass::HMD)
}

pub async fn get_analog_gain() -> Result<f32, String> {
    if !hmd_present().await {
        return Err("NO_HMD_FOUND".to_string());
    }
    let context_guard = OVR_CONTEXT.lock().await;
    let context = match context_guard.as_ref() {
        Some(context) => context,
        None => return Err("OPENVR_NOT_INITIALISED".to_string()),
    };
    if !settings_interface_available(context) {
        return Err("OPENVR_NOT_INITIALISED".to_string());
    }
    context
        .settings()
        .get_float(section(), c"analogGain")
        .map_err(|_| "ANALOG_GAIN_NOT_FOUND".to_string())
}

pub async fn set_analog_gain(analog_gain: f32) -> Result<(), String> {
    if !hmd_present().await {
        return Err("NO_HMD_FOUND".to_string());
    }
    let context_guard = OVR_CONTEXT.lock().await;
    let context = match context_guard.as_ref() {
        Some(context) => context,
        None => return Err("OPENVR_NOT_INITIALISED".to_string()),
    };
    if !settings_interface_available(context) {
        return Err("OPENVR_NOT_INITIALISED".to_string());
    }
    context
        .settings()
        .set_float(section(), c"analogGain", analog_gain)
        .map_err(|_| "ANALOG_GAIN_WRITE_FAILED".to_string())?;
    *KNOWN_ANALOG_GAIN.lock().await = Some(analog_gain);
    Ok(())
}

/// Reports the gain to the UI when it differs from the one OyasumiVR last wrote or reported.
pub async fn on_steamvr_section_changed() {
    if !hmd_present().await {
        return;
    }
    let context_guard = OVR_CONTEXT.lock().await;
    let Some(context) = context_guard.as_ref() else {
        return;
    };
    if !settings_interface_available(context) {
        return;
    }
    let Ok(analog_gain) = context.settings().get_float(section(), c"analogGain") else {
        return;
    };
    let mut known = KNOWN_ANALOG_GAIN.lock().await;
    if *known == Some(analog_gain) {
        return;
    }
    *known = Some(analog_gain);
    // emit before a write can take the lock, so the UI gets this report before that write ends
    send_event("OVR_ANALOG_GAIN_UPDATE", analog_gain).await;
}

/// Forgets the gain. Call after the context is gone, so the next session reports its first change.
pub async fn on_ovr_quit() {
    *KNOWN_ANALOG_GAIN.lock().await = None;
}
