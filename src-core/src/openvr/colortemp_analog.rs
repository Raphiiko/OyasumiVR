use ovr_overlay as ovr;
use std::ffi::CStr;

use crate::openvr::{devices::get_devices, models::TrackedDeviceClass, OVR_CONTEXT};

pub async fn set_color_temp(mut temperature: Option<u32>) -> Result<(f64, f64, f64), String> {
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
    if temperature.is_none() {
        temperature = Some(6600);
    }
    // Color temperature to RGB conversion based on algorithm by Tanner Helland
    // https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html
    let temperature = temperature.unwrap().max(1000).min(10000);
    let temperature = (temperature as f64) / 100.0;
    let red = if temperature <= 66.0 {
        255.0
    } else {
        let red = temperature - 60.0;
        let red = 329.698727446 * red.powf(-0.1332047592);
        red.max(0.0).min(255.0)
    } / 255.0;
    let green = if temperature <= 66.0 {
        let green = temperature;
        let green = 99.4708025861 * green.ln() - 161.1195681661;
        green.max(0.0).min(255.0)
    } else {
        let green = temperature - 60.0;
        let green = 288.1221695283 * green.powf(-0.0755148492);
        green.max(0.0).min(255.0)
    } / 255.0;
    let blue = if temperature >= 66.0 {
        255.0
    } else if temperature <= 19.0 {
        0.0
    } else {
        let blue = temperature - 10.0;
        let blue = 138.5177312231 * blue.ln() - 305.0447927307;
        blue.max(0.0).min(255.0)
    } / 255.0;
    let settings = &mut context.settings_mngr();
    let _ = settings.set_float(
        CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_Section).unwrap(),
        CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_HmdDisplayColorGainR_Float).unwrap(),
        red as f32,
    );
    let _ = settings.set_float(
        CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_Section).unwrap(),
        CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_HmdDisplayColorGainG_Float).unwrap(),
        green as f32,
    );
    let _ = settings.set_float(
        CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_Section).unwrap(),
        CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_HmdDisplayColorGainB_Float).unwrap(),
        blue as f32,
    );
    Ok((red, green, blue))
}
