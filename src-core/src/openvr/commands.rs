use crate::globals::STEAM_APP_KEY;

use super::{
    models::{BindingOriginData, OVRDevice, OVRFrameLimits},
    overlay_interface_available, OVR_CONTEXT,
};
use enumset::EnumSet;
use log::error;
use ovr::input::{InputString, InputValueHandle};
use ovr_overlay as ovr;
use std::fmt::Display;
use substring::Substring;

fn collect_localized_names<I, E>(results: I, label: &str) -> Vec<String>
where
    I: IntoIterator<Item = Result<String, E>>,
    E: Display,
{
    results
        .into_iter()
        .map(|result| match result {
            Ok(name) => name,
            Err(e) => {
                error!("[Core] Failed to get origin localized {label}: {e}");
                String::new()
            }
        })
        .collect()
}

fn assemble_binding_origins(
    origin_count: usize,
    localized_controller_types: &[String],
    localized_hands: &[String],
    localized_input_sources: &[String],
    binding_infos: &[ovr::sys::InputBindingInfo_t],
) -> Option<Vec<BindingOriginData>> {
    (0..origin_count)
        .map(|i| {
            let binding_info = binding_infos.get(i)?;
            let device_path_name = crate::utils::convert_char_array_to_string(
                &binding_info.rchDevicePathName,
            )?;
            let input_path_name = crate::utils::convert_char_array_to_string(
                &binding_info.rchInputPathName,
            )?;
            let localized_controller_type = localized_controller_types.get(i)?;
            let localized_hand = localized_hands.get(i)?;
            let localized_input_source = localized_input_sources.get(i)?;
            Some(BindingOriginData {
                localized_controller_type: if localized_controller_type.is_empty() {
                    device_path_name.clone()
                } else {
                    localized_controller_type.clone()
                },
                localized_hand: if localized_hand.is_empty() {
                    device_path_name.clone()
                } else {
                    localized_hand.clone()
                },
                localized_input_source: if localized_input_source.is_empty() {
                    input_path_name.clone()
                } else {
                    localized_input_source.clone()
                },
                device_path_name,
                input_path_name,
                mode_name: crate::utils::convert_char_array_to_string(&binding_info.rchModeName)?,
                slot_name: crate::utils::convert_char_array_to_string(&binding_info.rchSlotName)?,
                input_source_type: crate::utils::convert_char_array_to_string(
                    &binding_info.rchInputSourceType,
                )?,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn openvr_set_app_framelimit(
    app_id: u32,
    limits: Option<OVRFrameLimits>,
) -> Result<(), String> {
    super::framelimiter::set_app_framelimits(app_id, limits).await
}

#[tauri::command]
pub async fn openvr_get_app_framelimit(app_id: u32) -> Result<Option<OVRFrameLimits>, String> {
    super::framelimiter::get_app_framelimits(app_id).await
}

#[tauri::command]
pub async fn openvr_set_init_delay_fix(enabled: bool) {
    *super::OVR_INIT_DELAY_FIX.lock().await = enabled;
}

#[tauri::command]
pub async fn openvr_get_devices() -> Vec<OVRDevice> {
    super::devices::get_devices().await
}

#[tauri::command]
pub async fn openvr_status() -> String {
    let status = super::OVR_STATUS.lock().await;
    let status_str = serde_json::to_string(&*status).unwrap();
    status_str.substring(1, status_str.len() - 1).to_string()
}

#[tauri::command]
pub async fn openvr_set_analog_gain(analog_gain: f32) -> Result<(), String> {
    super::brightness_analog::set_analog_gain(analog_gain).await
}

#[tauri::command]
pub async fn openvr_get_analog_gain() -> Result<f32, String> {
    super::brightness_analog::get_analog_gain().await
}

#[tauri::command]
pub async fn openvr_set_supersample_scale(supersample_scale: Option<f32>) -> Result<(), String> {
    super::supersampling::set_supersample_scale(supersample_scale).await
}

#[tauri::command]
pub async fn openvr_get_supersample_scale() -> Result<Option<f32>, String> {
    super::supersampling::get_supersample_scale().await
}

#[tauri::command]
pub async fn openvr_set_fade_distance(fade_distance: f32) -> Result<(), String> {
    super::chaperone::set_fade_distance(fade_distance).await
}

#[tauri::command]
pub async fn openvr_get_fade_distance() -> Result<f32, String> {
    super::chaperone::get_fade_distance().await
}

#[tauri::command]
pub async fn openvr_set_analog_color_temp(
    temperature: Option<u32>,
) -> Result<(f64, f64, f64), String> {
    super::colortemp_analog::set_color_temp(temperature).await
}

#[tauri::command]
pub async fn openvr_set_image_brightness(
    brightness: f64,
    perceived_brightness_adjustment_gamma: Option<f64>,
) {
    super::brightness_overlay::set_brightness(brightness, perceived_brightness_adjustment_gamma)
        .await;
}

#[tauri::command]
pub async fn openvr_launch_binding_configuration(show_on_desktop: bool) {
    let context = OVR_CONTEXT.lock().await;
    let mut input = match context.as_ref() {
        Some(context) => context.input_mngr(),
        None => return,
    };
    let input_handle = match input.get_input_source_handle("/user/hand/right") {
        Ok(handle) => handle,
        Err(e) => {
            error!("[Core] Failed to get input source handle: {e}");
            return;
        }
    };
    if let Err(e) = input.open_binding_ui(None, None, input_handle, show_on_desktop) {
        error!("[Core] Failed to open SteamVR binding UI: {e}");
    }
}

#[tauri::command]
pub async fn openvr_is_dashboard_visible() -> bool {
    let context = OVR_CONTEXT.lock().await;
    if !overlay_interface_available() {
        return false;
    }
    let mut manager = match context.as_ref() {
        Some(context) => context.overlay_mngr(),
        None => return false,
    };
    manager.is_dashboard_visible()
}

#[tauri::command]
pub async fn openvr_reregister_manifest() -> Result<(), String> {
    let ctx = OVR_CONTEXT.lock().await;
    let ctx = ctx.as_ref().ok_or("OPENVR_NOT_INITIALIZED")?;
    let mut applications = ctx.applications_mngr();
    let manifest_path_buf = std::fs::canonicalize("resources/manifest.vrmanifest")
        .map_err(|e| format!("MANIFEST_NOT_FOUND: {e}"))?;
    let manifest_path: &std::path::Path = manifest_path_buf.as_ref();
    match applications.is_application_installed(STEAM_APP_KEY) {
        Ok(value) => {
            if !value {
                Err(String::from("MANIFEST_NOT_REGISTERED"))
            } else {
                match applications.remove_application_manifest(manifest_path) {
                    Ok(_) => {
                        let install_for_flavours = [
                            crate::flavour::BuildFlavour::Standalone,
                            crate::flavour::BuildFlavour::Dev,
                        ];
                        let should_install_for_flavour =
                            install_for_flavours.contains(&crate::flavour::BUILD_FLAVOUR);
                        if should_install_for_flavour {
                            match applications.add_application_manifest(manifest_path, false) {
                                Ok(_) => {
                                    Ok(())
                                }
                                Err(e) => {
                                    error!("[Core] Failed to add VR manifest: {e}");
                                    Err(String::from("MANIFEST_ADD_FAILED"))
                                }
                            }
                        } else {
                            Err(String::from("FLAVOUR_NOT_ELIGIBLE"))
                        }
                    }
                    Err(e) => {
                        error!("[Core] Failed to remove VR manifest: {e}");
                        Err(String::from("MANIFEST_REMOVE_FAILED"))
                    }
                }
            }
        }
        Err(e) => {
            error!(
                "[Core] Failed to check if VR manifest is registered: {:#?}",
                e.description()
            );
            Err(String::from("MANIFEST_CHECK_FAILED"))
        }
    }
}

#[tauri::command]
pub async fn openvr_get_binding_origins(
    action_set_key: String,
    action_key: String,
) -> Result<Vec<BindingOriginData>, String> {
    let mut input_ctx = super::OVR_INPUT_CONTEXT.lock().await;
    // Get action set by name
    let action_set = match input_ctx
        .action_sets
        .iter()
        .find(|a| a.name == action_set_key)
    {
        Some(action_set) => action_set.handle,
        None => return Err(String::from("ACTION_SET_NOT_FOUND")),
    };
    // Get action by name
    let action = match input_ctx.actions.iter().find(|a| a.name == action_key) {
        Some(action) => action.handle,
        None => return Err(String::from("ACTION_NOT_FOUND")),
    };
    // Get the input service
    let context = OVR_CONTEXT.lock().await;
    let mut input = match context.as_ref() {
        Some(context) => context.input_mngr(),
        None => return Err(String::from("OPENVR_NOT_INITIALIZED")),
    };
    if let Err(e) = input.update_actions(input_ctx.active_sets.as_mut_slice()) {
        error!("[Core] Failed to update actions: {e}");
        return Err(String::from("UPDATE_ACTIONS_FAILED"));
    }
    // Get all of the origins for this action
    let origins: Vec<u64> = match input.get_action_origins(action_set, action) {
        Ok(origins) => origins
            .iter()
            .filter(|origin| **origin > 0)
            .cloned()
            .collect(),
        Err(e) => {
            error!("[Core] Failed to get action origins: {e}");
            return Err(String::from("GET_ACTION_ORIGINS_FAILED"));
        }
    };
    // get localized labels for each origin
    let localized_controller_types = collect_localized_names(
        origins.iter().map(|origin| {
            input.get_origin_localized_name(
                InputValueHandle(*origin),
                EnumSet::only(InputString::ControllerType),
            )
        }),
        "controller type",
    );
    let localized_hands = collect_localized_names(
        origins.iter().map(|origin| {
            input.get_origin_localized_name(
                InputValueHandle(*origin),
                EnumSet::only(InputString::Hand),
            )
        }),
        "hand",
    );
    let localized_input_sources = collect_localized_names(
        origins.iter().map(|origin| {
            input.get_origin_localized_name(
                InputValueHandle(*origin),
                EnumSet::only(InputString::InputSource),
            )
        }),
        "input source",
    );

    // Get extra information about each binding
    let binding_infos: Vec<ovr::sys::InputBindingInfo_t> =
        match input.get_action_binding_info(action) {
            Ok(result) => result,
            Err(e) => {
                error!("[Core] Failed to get action binding info: {e}");
                return Err(String::from("GET_ACTION_BINDING_INFO_FAILED"));
            }
        };
    match assemble_binding_origins(
        origins.len(),
        &localized_controller_types,
        &localized_hands,
        &localized_input_sources,
        &binding_infos,
    ) {
        Some(data) => Ok(data),
        None => {
            error!("[Core] OpenVR returned incomplete binding origin data");
            Err(String::from("INCOMPLETE_BINDING_DATA"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{assemble_binding_origins, collect_localized_names, ovr};
    use std::ffi::c_char;

    fn char_array<const N: usize>(value: &str) -> [c_char; N] {
        let mut result = [0; N];
        for (target, source) in result.iter_mut().zip(value.bytes()) {
            *target = source as c_char;
        }
        result
    }

    fn binding_info(device_path_name: &str) -> ovr::sys::InputBindingInfo_t {
        ovr::sys::InputBindingInfo_t {
            rchDevicePathName: char_array(device_path_name),
            rchInputPathName: char_array("/input/a"),
            rchModeName: char_array("button"),
            rchSlotName: char_array("click"),
            rchInputSourceType: char_array("button"),
        }
    }

    #[test]
    fn localized_name_errors_keep_origin_alignment() {
        let controller_types = collect_localized_names(
            [Ok("controller one".to_string()), Err("lookup failed")],
            "controller type",
        );
        let data = assemble_binding_origins(
            2,
            &controller_types,
            &["left".to_string(), "right".to_string()],
            &["a".to_string(), "b".to_string()],
            &[
                binding_info("/user/hand/left"),
                binding_info("/user/hand/right"),
            ],
        )
        .unwrap();

        assert_eq!(data.len(), 2);
        assert_eq!(data[0].localized_controller_type, "controller one");
        assert_eq!(data[0].device_path_name, "/user/hand/left");
        assert_eq!(
            data[1].localized_controller_type,
            "/user/hand/right"
        );
        assert_eq!(data[1].localized_hand, "right");
        assert_eq!(data[1].localized_input_source, "b");
        assert_eq!(data[1].device_path_name, "/user/hand/right");
    }
}
