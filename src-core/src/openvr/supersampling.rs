use std::ffi::CStr;

use super::OVR_CONTEXT;

pub async fn get_supersample_scale() -> Result<Option<f32>, String> {
    let context_guard = OVR_CONTEXT.lock().await;
    let context = match context_guard.as_ref() {
        Some(context) => context,
        None => return Err("OPENVR_NOT_INITIALISED".to_string()),
    };
    let settings = &mut context.settings().unwrap();
    let supersample_manual_override = settings.get_bool(
        CStr::from_bytes_with_nul(openvr_sys::k_pch_SteamVR_Section).unwrap(),
        c"supersampleManualOverride",
    );
    let supersample_manual_override = match supersample_manual_override {
        Ok(supersample_manual_override) => supersample_manual_override,
        Err(_) => return Err("SUPERSAMPLE_MANUAL_OVERRIDE_NOT_FOUND".to_string()),
    };
    // Supersampling is set to auto
    if !supersample_manual_override {
        return Ok(None);
    }
    // Supersampling is set to custom
    let supersample_scale = settings.get_float(
        CStr::from_bytes_with_nul(openvr_sys::k_pch_SteamVR_Section).unwrap(),
        c"supersampleScale",
    );
    match supersample_scale {
        Ok(supersample_scale) => Ok(Some(supersample_scale)),
        Err(_) => Err("SUPERSAMPLE_SCALE_NOT_FOUND".to_string()),
    }
}

pub async fn set_supersample_scale(supersample_scale: Option<f32>) -> Result<(), String> {
    let context_guard = OVR_CONTEXT.lock().await;
    let context = match context_guard.as_ref() {
        Some(context) => context,
        None => return Err("OPENVR_NOT_INITIALISED".to_string()),
    };
    let settings = &mut context.settings().unwrap();
    let _ = settings.set_bool(
        CStr::from_bytes_with_nul(openvr_sys::k_pch_SteamVR_Section).unwrap(),
        c"supersampleManualOverride",
        supersample_scale.is_some(),
    );
    if let Some(scale) = supersample_scale {
        let _ = settings.set_float(
            CStr::from_bytes_with_nul(openvr_sys::k_pch_SteamVR_Section).unwrap(),
            c"supersampleScale",
            scale,
        );
    }
    Ok(())
}
