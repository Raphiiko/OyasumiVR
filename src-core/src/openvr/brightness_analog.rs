use std::ffi::CStr;

use super::devices::get_devices;
use super::models::TrackedDeviceClass;
use super::OVR_CONTEXT;

pub async fn get_analog_gain() -> Result<f32, String> {
    let devices = get_devices().await;
    let device = devices
        .iter()
        .find(|device| device.class == TrackedDeviceClass::HMD);
    if device.is_some() {
        let context_guard = OVR_CONTEXT.lock().await;
        let context = match context_guard.as_ref() {
            Some(context) => context,
            None => return Err("OPENVR_NOT_INITIALISED".to_string()),
        };
        let mut settings = context.settings().unwrap();
        
        let analog_gain = settings.get_float(
            CStr::from_bytes_with_nul(openvr_sys::k_pch_SteamVR_Section).unwrap(),
            c"analogGain",
        );
        match analog_gain {
            Ok(analog_gain) => Ok(analog_gain),
            Err(_) => Err("ANALOG_GAIN_NOT_FOUND".to_string()),
        }
    } else {
        Err("NO_HMD_FOUND".to_string())
    }
}

pub async fn set_analog_gain(analog_gain: f32) -> Result<(), String> {
    let devices = get_devices().await;
    let device = devices
        .iter()
        .find(|device| device.class == TrackedDeviceClass::HMD);
    if device.is_some() {
        let context_guard = OVR_CONTEXT.lock().await;
        let context = match context_guard.as_ref() {
            Some(context) => context,
            None => return Err("OPENVR_NOT_INITIALISED".to_string()),
        };
        let settings = &mut context.settings().unwrap();
        let _ = settings.set_float(
            CStr::from_bytes_with_nul(openvr_sys::k_pch_SteamVR_Section).unwrap(),
            c"analogGain",
            analog_gain,
        );
        Ok(())
    } else {
        Err("NO_HMD_FOUND".to_string())
    }
}
