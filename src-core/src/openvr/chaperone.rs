use std::ffi::CStr;

use super::OVR_CONTEXT;
use ovr_overlay as ovr;

pub async fn get_fade_distance() -> Result<f32, String> {
    let context_guard = OVR_CONTEXT.lock().await;
    let context = match context_guard.as_ref() {
        Some(context) => context,
        None => return Err("OPENVR_NOT_INITIALISED".to_string()),
    };
    let settings = &mut context.settings_mngr();
    let fade_distance = settings.get_float(
        CStr::from_bytes_with_nul(ovr::sys::k_pch_CollisionBounds_Section).unwrap(),
        CStr::from_bytes_with_nul(b"CollisionBoundsFadeDistance\0").unwrap(),
    );
    match fade_distance {
        Ok(fade_distance) => Ok(fade_distance),
        Err(_) => Err("FADE_DISTANCE_NOT_FOUND".to_string()),
    }
}

pub async fn set_fade_distance(fade_distance: f32) -> Result<(), String> {
    let context_guard = OVR_CONTEXT.lock().await;
    let context = match context_guard.as_ref() {
        Some(context) => context,
        None => return Err("OPENVR_NOT_INITIALISED".to_string()),
    };
    let settings = &mut context.settings_mngr();
    let _ = settings.set_float(
        CStr::from_bytes_with_nul(ovr::sys::k_pch_CollisionBounds_Section).unwrap(),
        CStr::from_bytes_with_nul(b"CollisionBoundsFadeDistance\0").unwrap(),
        fade_distance,
    );
    Ok(())
}
