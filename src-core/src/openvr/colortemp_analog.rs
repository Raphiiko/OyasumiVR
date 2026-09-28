use oyasumivr_shared::color_temperature;
use raphii_openvr_rs as ovr;
use std::ffi::CStr;

use crate::openvr::{
    devices::get_devices, models::TrackedDeviceClass, settings_interface_available, OVR_CONTEXT,
};

pub async fn set_color_temp(temperature: Option<u32>) -> Result<(f64, f64, f64), String> {
    let devices = get_devices().await;
    let device = devices
        .iter()
        .find(|device| device.class == TrackedDeviceClass::HMD);
    if device.is_none() {
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
    let [red, green, blue] = color_temperature::kelvin_to_gains(
        temperature.unwrap_or(color_temperature::NEUTRAL_KELVIN),
    );
    let settings = &context.settings();
    let _ = settings.set_float(
        CStr::from_bytes_with_nul(ovr::raw::k_pch_SteamVR_Section).unwrap(),
        CStr::from_bytes_with_nul(ovr::raw::k_pch_SteamVR_HmdDisplayColorGainR_Float).unwrap(),
        red as f32,
    );
    let _ = settings.set_float(
        CStr::from_bytes_with_nul(ovr::raw::k_pch_SteamVR_Section).unwrap(),
        CStr::from_bytes_with_nul(ovr::raw::k_pch_SteamVR_HmdDisplayColorGainG_Float).unwrap(),
        green as f32,
    );
    let _ = settings.set_float(
        CStr::from_bytes_with_nul(ovr::raw::k_pch_SteamVR_Section).unwrap(),
        CStr::from_bytes_with_nul(ovr::raw::k_pch_SteamVR_HmdDisplayColorGainB_Float).unwrap(),
        blue as f32,
    );
    Ok((red, green, blue))
}
