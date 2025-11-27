use std::ffi::CStr;

use super::{models::OVRFrameLimits, OVR_CONTEXT};

pub async fn set_app_framelimits(
    app_id: u32,
    limits: Option<OVRFrameLimits>,
) -> Result<(), String> {
    let context_guard = OVR_CONTEXT.lock().await;
    let context = match context_guard.as_ref() {
        Some(context) => context,
        None => return Err("OPENVR_NOT_INITIALISED".to_string()),
    };
    let settings = &mut context.settings().unwrap();

    let section_string = format!("steam.app.{}\0", app_id);
    let pch_section = CStr::from_bytes_with_nul(section_string.as_bytes()).unwrap();
    let pch_settings_key_additional_frames_to_predict = c"additionalFramesToPredict";
    let pch_settings_key_frames_to_throttle = c"framesToThrottle";
        
    if let Some(limits) = limits {
        let _ = settings.set_int32(
            pch_section,
            pch_settings_key_additional_frames_to_predict,
            limits.additional_frames_to_predict as i32,
        );
        let _ = settings.set_int32(
            pch_section,
            pch_settings_key_frames_to_throttle,
            limits.frames_to_throttle as i32,
        );
    } else {
        let _ = settings
            .remove_key_in_section(pch_section, pch_settings_key_additional_frames_to_predict);
        let _ = settings.remove_key_in_section(pch_section, pch_settings_key_frames_to_throttle);
    }

    Ok(())
}

pub async fn get_app_framelimits(app_id: u32) -> Result<Option<OVRFrameLimits>, String> {
    let context_guard = OVR_CONTEXT.lock().await;
    let context = match context_guard.as_ref() {
        Some(context) => context,
        None => return Err("OPENVR_NOT_INITIALISED".to_string()),
    };
    let settings = &mut context.settings().unwrap();

    let section_string = format!("steam.app.{}\0", app_id);
    let pch_section = CStr::from_bytes_with_nul(section_string.as_bytes()).unwrap();
    let pch_settings_key_additional_frames_to_predict = c"additionalFramesToPredict";
    let pch_settings_key_frames_to_throttle = c"framesToThrottle";

    let additional_frames_to_predict =
        settings.get_int32(pch_section, pch_settings_key_additional_frames_to_predict);
    let frames_to_throttle = settings.get_int32(pch_section, pch_settings_key_frames_to_throttle);

    match (additional_frames_to_predict, frames_to_throttle) {
        (Ok(additional_frames_to_predict), Ok(frames_to_throttle)) => Ok(Some(OVRFrameLimits {
            additional_frames_to_predict: additional_frames_to_predict as u8,
            frames_to_throttle: frames_to_throttle as u8,
        })),
        _ => Ok(None),
    }
}
