use std::collections::HashMap;

use super::models::{
    DeviceUpdateEvent, OVRDevice, OVRDevicePose, OVRHandleType, OpenVRInputEvent,
    TrackedDeviceClass,
};
use super::{GestureDetector, SleepDetector, OVR_CONTEXT};
use crate::utils::send_event;
use chrono::{DateTime, Duration, Utc};
use log::error;
use ovr::input::InputValueHandle;
use ovr::raw::EVRInputError;
use raphii_openvr_rs as ovr;
use std::sync::LazyLock;
use strum::IntoEnumIterator;
use tokio::sync::Mutex;

static OVR_DEVICES: LazyLock<Mutex<Vec<OVRDevice>>> = LazyLock::new(|| Mutex::new(Vec::new()));
static SLEEP_DETECTOR: LazyLock<Mutex<SleepDetector>> =
    LazyLock::new(|| Mutex::new(SleepDetector::new()));
static GESTURE_DETECTOR: LazyLock<Mutex<GestureDetector>> =
    LazyLock::new(|| Mutex::new(GestureDetector::new()));
static NEXT_DEVICE_REFRESH: LazyLock<Mutex<DateTime<Utc>>> =
    LazyLock::new(|| Mutex::new(DateTime::from_timestamp_millis(0).unwrap()));
static NEXT_POSE_BROADCAST: LazyLock<Mutex<DateTime<Utc>>> =
    LazyLock::new(|| Mutex::new(DateTime::from_timestamp_millis(0).unwrap()));
static DEVICE_CLASS_CACHE: LazyLock<Mutex<HashMap<u32, TrackedDeviceClass>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static DEVICE_HANDLE_TYPE_CACHE: LazyLock<Mutex<HashMap<u32, OVRHandleType>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Call from the OpenVR task after releasing the context lock.
pub async fn on_ovr_quit() {
    OVR_DEVICES.lock().await.clear();
    DEVICE_CLASS_CACHE.lock().await.clear();
    DEVICE_HANDLE_TYPE_CACHE.lock().await.clear();
    *NEXT_DEVICE_REFRESH.lock().await = DateTime::from_timestamp_millis(0).unwrap();
}

pub async fn on_ovr_tick() {
    // Refresh all devices when needed
    let mut next_device_refresh = NEXT_DEVICE_REFRESH.lock().await;
    if (Utc::now() - *next_device_refresh).num_milliseconds() > 0 {
        *next_device_refresh = Utc::now() + Duration::seconds(5);
        update_handle_types().await;
        update_all_devices(true).await;
    }
    // Update poses
    refresh_device_poses().await;
    // Detect inputs
    detect_inputs().await;
}

pub async fn on_ovr_event(event: ovr::system::VREvent) {
    match event.event_type() {
        ovr::raw::EVREventType::VREvent_TrackedDeviceActivated
        | ovr::raw::EVREventType::VREvent_TrackedDeviceDeactivated => {
            update_device(event.tracked_device_index(), true).await;
        }
        ovr::raw::EVREventType::VREvent_PropertyChanged => {
            let Some(tracked_device_property) = event.changed_property() else {
                return;
            };
            let matching_properties = [
                ovr::raw::ETrackedDeviceProperty::Prop_DeviceBatteryPercentage_Float,
                ovr::raw::ETrackedDeviceProperty::Prop_DeviceProvidesBatteryStatus_Bool,
                ovr::raw::ETrackedDeviceProperty::Prop_DeviceCanPowerOff_Bool,
                ovr::raw::ETrackedDeviceProperty::Prop_DeviceIsCharging_Bool,
                ovr::raw::ETrackedDeviceProperty::Prop_ConnectedWirelessDongle_String,
                ovr::raw::ETrackedDeviceProperty::Prop_SerialNumber_String,
                ovr::raw::ETrackedDeviceProperty::Prop_HardwareRevision_String,
                ovr::raw::ETrackedDeviceProperty::Prop_ManufacturerName_String,
                ovr::raw::ETrackedDeviceProperty::Prop_ModelNumber_String,
            ];
            if matching_properties.contains(&tracked_device_property) {
                update_device(event.tracked_device_index(), true).await;
            }
        }
        _ => {}
    }
}

pub async fn get_devices() -> Vec<OVRDevice> {
    let devices = OVR_DEVICES.lock().await;
    devices.clone()
}

async fn update_handle_types() {
    {
        DEVICE_HANDLE_TYPE_CACHE.lock().await.clear();
    }

    for handle_type in OVRHandleType::iter() {
        update_handle_type(handle_type).await;
    }
}

async fn update_handle_type(handle_type: OVRHandleType) {
    let context = OVR_CONTEXT.lock().await;
    let mut device_handle_cache = DEVICE_HANDLE_TYPE_CACHE.lock().await;
    let input = match context.as_ref() {
        Some(context) => context.input(),
        None => return,
    };

    let action_handle = match input.get_input_source_handle(handle_type.as_action_handle()) {
        Ok(handle) => handle,
        Err(err) => {
            error!(
                "[Core] Unable to get action handle by name {}: {err}",
                handle_type.as_action_handle()
            ); // shouldn't happen but log just in case
            return;
        }
    };

    let device_info = match input.get_origin_tracked_device_info(action_handle) {
        Ok(info) => info,
        Err(err) => {
            // expected errors
            if err == EVRInputError::VRInputError_NoData.into()
                || err == EVRInputError::VRInputError_InvalidHandle.into()
            {
                return;
            }
            error!(
                "[Core] Unable to get device info for handle {}: {err}",
                handle_type.as_action_handle()
            ); // unexpected error
            return;
        }
    };
    device_handle_cache.insert(device_info.0.trackedDeviceIndex, handle_type);
}

async fn update_all_devices(emit: bool) {
    for n in 0..(ovr::raw::k_unMaxTrackedDeviceCount as usize) {
        update_device(ovr::TrackedDeviceIndex(n.try_into().unwrap()), emit).await;
    }
}

async fn update_device(device_index: ovr::TrackedDeviceIndex, emit: bool) {
    let context = OVR_CONTEXT.lock().await;
    let system = match context.as_ref() {
        Some(context) => context.system(),
        None => return,
    };
    let class: TrackedDeviceClass = system
        .get_tracked_device_class(device_index)
        .unwrap_or(ovr::raw::ETrackedDeviceClass::TrackedDeviceClass_Invalid)
        .into();
    let mut device_class_cache = DEVICE_CLASS_CACHE.lock().await;
    let device_handle_cache = DEVICE_HANDLE_TYPE_CACHE.lock().await;
    // Stop here if the class is invalid and we don't have it cached
    if class == TrackedDeviceClass::Invalid && !device_class_cache.contains_key(&device_index.0) {
        return;
    }
    // Update class cache
    if class == TrackedDeviceClass::Invalid {
        device_class_cache.remove(&device_index.0);
    } else {
        device_class_cache.insert(device_index.0, class.clone());
    }
    drop(device_class_cache);

    let handle_type: Option<OVRHandleType> = device_handle_cache.get(&device_index.0).cloned();
    drop(device_handle_cache);
    // Get device properties
    let battery: Option<f32> = system
        .get_tracked_device_property(
            device_index,
            ovr::raw::ETrackedDeviceProperty::Prop_DeviceBatteryPercentage_Float,
        )
        .ok();
    let provides_battery_status: Option<bool> = system
        .get_tracked_device_property(
            device_index,
            ovr::raw::ETrackedDeviceProperty::Prop_DeviceProvidesBatteryStatus_Bool,
        )
        .ok();
    let can_power_off: Option<bool> = system
        .get_tracked_device_property(
            device_index,
            ovr::raw::ETrackedDeviceProperty::Prop_DeviceCanPowerOff_Bool,
        )
        .ok();
    let is_charging: Option<bool> = system
        .get_tracked_device_property(
            device_index,
            ovr::raw::ETrackedDeviceProperty::Prop_DeviceIsCharging_Bool,
        )
        .ok();
    let dongle_id: Option<String> = system
        .get_tracked_device_property(
            device_index,
            ovr::raw::ETrackedDeviceProperty::Prop_ConnectedWirelessDongle_String,
        )
        .ok();
    let serial_number: Option<String> = system
        .get_tracked_device_property(
            device_index,
            ovr::raw::ETrackedDeviceProperty::Prop_SerialNumber_String,
        )
        .ok();
    let hardware_revision: Option<String> = system
        .get_tracked_device_property(
            device_index,
            ovr::raw::ETrackedDeviceProperty::Prop_HardwareRevision_String,
        )
        .ok();
    let manufacturer_name: Option<String> = system
        .get_tracked_device_property(
            device_index,
            ovr::raw::ETrackedDeviceProperty::Prop_ManufacturerName_String,
        )
        .ok();
    let model_number: Option<String> = system
        .get_tracked_device_property(
            device_index,
            ovr::raw::ETrackedDeviceProperty::Prop_ModelNumber_String,
        )
        .ok();
    let mut hmd_on_head = None;
    let mut hmd_activity = None;
    let mut display_frequency = None;
    if class == TrackedDeviceClass::HMD {
        let activity_level = system
            .get_tracked_device_activity_level(device_index)
            .unwrap_or(ovr::raw::EDeviceActivityLevel::k_EDeviceActivityLevel_Unknown);
        hmd_on_head = Some(activity_level == ovr::raw::EDeviceActivityLevel::k_EDeviceActivityLevel_UserInteraction || activity_level == ovr::raw::EDeviceActivityLevel::k_EDeviceActivityLevel_UserInteraction_Timeout);

        hmd_activity = Some(
            match activity_level {
                ovr::raw::EDeviceActivityLevel::k_EDeviceActivityLevel_Idle => "Idle",
                ovr::raw::EDeviceActivityLevel::k_EDeviceActivityLevel_UserInteraction => {
                    "UserInteraction"
                }
                ovr::raw::EDeviceActivityLevel::k_EDeviceActivityLevel_UserInteraction_Timeout => {
                    "UserInteractionTimeout"
                }
                ovr::raw::EDeviceActivityLevel::k_EDeviceActivityLevel_Standby => "Standby",
                ovr::raw::EDeviceActivityLevel::k_EDeviceActivityLevel_Idle_Timeout => {
                    "IdleTimeout"
                }
                _ => "Unknown",
            }
            .to_string(),
        );
        display_frequency = system
            .get_tracked_device_property(
                device_index,
                ovr::raw::ETrackedDeviceProperty::Prop_DisplayFrequency_Float,
            )
            .ok();
    }

    let device = OVRDevice {
        index: device_index.0,
        class,
        role: system
            .get_controller_role_for_tracked_device_index(device_index)
            .unwrap_or(ovr::raw::ETrackedControllerRole::TrackedControllerRole_Invalid)
            .into(),
        battery,
        provides_battery_status,
        can_power_off,
        is_charging,
        dongle_id,
        serial_number,
        hardware_revision,
        manufacturer_name,
        model_number,
        handle_type,
        hmd_on_head,
        hmd_activity,
        display_frequency,
    };

    // publish changed snapshots after releasing the device cache
    let changed = {
        let mut devices = OVR_DEVICES.lock().await;
        store_device(&mut devices, &device)
    };
    if emit && changed {
        let event = DeviceUpdateEvent { device };
        send_event("OVR_DEVICE_UPDATE", event).await;
    }
}

fn store_device(devices: &mut Vec<OVRDevice>, device: &OVRDevice) -> bool {
    if let Some(previous) = devices
        .iter_mut()
        .find(|previous| previous.index == device.index)
    {
        if *previous == *device {
            return false;
        }
        *previous = device.clone();
    } else {
        devices.push(device.clone());
    }
    true
}

async fn refresh_device_poses() {
    let poses = {
        let context = OVR_CONTEXT.lock().await;
        let system = match context.as_ref() {
            Some(context) => context.system(),
            None => return,
        };
        system.get_device_to_absolute_tracking_pose(
            ovr::raw::ETrackingUniverseOrigin::TrackingUniverseStanding,
            0.0,
        )
    };
    let poses = match poses {
        Ok(poses) => poses,
        Err(e) => {
            error!("[Core] Failed to read OpenVR poses: {e}");
            return;
        }
    };
    for (n, pose) in poses.iter().enumerate() {
        if pose.bDeviceIsConnected && pose.bPoseIsValid {
            let matrix = pose.mDeviceToAbsoluteTracking.m;
            // Extract quaternion
            let q = ovr::raw::HmdQuaternion_t {
                w: 0.0f64
                    .max((1.0 + matrix[0][0] + matrix[1][1] + matrix[2][2]).into())
                    .sqrt()
                    / 2.0,
                x: (0.0f64
                    .max((1.0 + matrix[0][0] - matrix[1][1] - matrix[2][2]).into())
                    .sqrt()
                    / 2.0)
                    .copysign((matrix[2][1] - matrix[1][2]).into()),
                y: (0.0f64
                    .max((1.0 - matrix[0][0] + matrix[1][1] - matrix[2][2]).into())
                    .sqrt()
                    / 2.0)
                    .copysign((matrix[0][2] - matrix[2][0]).into()),
                z: (0.0f64
                    .max((1.0 - matrix[0][0] - matrix[1][1] + matrix[2][2]).into())
                    .sqrt()
                    / 2.0)
                    .copysign((matrix[1][0] - matrix[0][1]).into()),
            };
            // Extract position
            let pos = ovr::raw::HmdVector3_t {
                v: [matrix[0][3], matrix[1][3], matrix[2][3]],
            };
            // Update sleep and gesture detectors (0 == HMD)
            if n == 0 {
                SLEEP_DETECTOR
                    .lock()
                    .await
                    .log_pose(pos.v, [q.x, q.y, q.z, q.w])
                    .await;
                GESTURE_DETECTOR
                    .lock()
                    .await
                    .log_pose(pos.v, [q.x, q.y, q.z, q.w])
                    .await;
            }
            // Emit event
            if n == 0 {
                // Only for the HMD, the rest is not required
                let mut next_pose_broadcast = NEXT_POSE_BROADCAST.lock().await;
                if (Utc::now() - *next_pose_broadcast).num_milliseconds() > 0 {
                    *next_pose_broadcast = Utc::now() + Duration::milliseconds(250);
                    drop(next_pose_broadcast);
                    send_event(
                        "OVR_POSE_UPDATE",
                        OVRDevicePose {
                            index: n as u32,
                            quaternion: [q.x, q.y, q.z, q.w],
                            position: pos.v,
                        },
                    )
                    .await;
                }
            }
        }
    }
}

async fn detect_inputs() {
    let devices = OVR_DEVICES.lock().await;
    let mut input_ctx = super::OVR_INPUT_CONTEXT.lock().await;

    let context = OVR_CONTEXT.lock().await;
    let input = match context.as_ref() {
        Some(context) => context.input(),
        None => return,
    };
    // Update actions for all sets
    if let Err(e) = input.update_actions(input_ctx.active_sets.as_mut_slice()) {
        error!("[Core] Failed to update actions: {:?}", e.to_string());
        return;
    }
    for action in input_ctx.actions.iter() {
        match input.get_digital_action_data(
            action.handle,
            InputValueHandle(ovr::raw::k_ulInvalidInputValueHandle),
        ) {
            Ok(data) => {
                if data.0.bChanged {
                    let handle = InputValueHandle(data.0.activeOrigin);
                    let device = match input.get_origin_tracked_device_info(handle) {
                        Ok(r) => devices
                            .iter()
                            .find(|d| d.index == r.0.trackedDeviceIndex)
                            .cloned(),
                        Err(e) => {
                            error!(
                                "[Core] Failed to get origin tracked device info: {:?}",
                                e.to_string()
                            );
                            return;
                        }
                    };
                    let event = OpenVRInputEvent {
                        action: action.name.clone(),
                        pressed: data.0.bState,
                        time_ago: data.0.fUpdateTime,
                        device,
                    };
                    tokio::spawn(async move {
                        send_event("OVR_INPUT_EVENT_DIGITAL", event).await;
                    });
                }
            }
            Err(e) => {
                error!("[Core] Failed to get action data: {:?}", e.to_string());
                return;
            }
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> OVRDevice {
        serde_json::from_value(serde_json::json!({
            "index": 7, "class": "Controller", "role": "LeftHand",
            "battery": 0.5, "providesBatteryStatus": true, "canPowerOff": true,
            "isCharging": false, "dongleId": "dongle", "serialNumber": "serial",
            "hardwareRevision": "1", "manufacturerName": "manufacturer",
            "modelNumber": "model", "handleType": "HandPrimary",
            "hmdOnHead": false, "hmdActivity": "Idle", "displayFrequency": 90.0
        }))
        .unwrap()
    }

    #[test]
    fn identical_snapshots_request_only_the_first_event() {
        let mut devices = Vec::new();
        let device = snapshot();
        assert!(store_device(&mut devices, &device));
        assert!(!store_device(&mut devices, &device));
        assert_eq!(devices.len(), 1);
    }

    #[test]
    fn every_serialized_field_can_trigger_a_new_event() {
        let original = snapshot();
        let baseline = serde_json::to_value(&original).unwrap();
        let changes = [
            ("index", serde_json::json!(8)),
            ("class", serde_json::json!("GenericTracker")),
            ("role", serde_json::json!("RightHand")),
            ("battery", serde_json::json!(0.6)),
            ("providesBatteryStatus", serde_json::json!(false)),
            ("canPowerOff", serde_json::json!(false)),
            ("isCharging", serde_json::json!(true)),
            ("dongleId", serde_json::json!("other dongle")),
            ("serialNumber", serde_json::json!("other serial")),
            ("hardwareRevision", serde_json::json!("2")),
            ("manufacturerName", serde_json::json!("other manufacturer")),
            ("modelNumber", serde_json::json!("other model")),
            ("handleType", serde_json::json!("HandSecondary")),
            ("hmdOnHead", serde_json::json!(true)),
            ("hmdActivity", serde_json::json!("UserInteraction")),
            ("displayFrequency", serde_json::json!(120.0)),
        ];
        assert_eq!(baseline.as_object().unwrap().len(), changes.len());
        for (field, value) in changes {
            let mut devices = vec![original.clone()];
            let mut changed = baseline.clone();
            changed[field] = value;
            let changed: OVRDevice = serde_json::from_value(changed).unwrap();
            assert!(store_device(&mut devices, &changed), "{field}");
            assert!(!store_device(&mut devices, &changed), "{field}");
            assert!(devices.iter().any(|stored| stored == &changed), "{field}");
        }
    }

    #[test]
    fn invalidation_and_index_reuse_each_request_one_event() {
        let mut device = snapshot();
        let mut devices = vec![device.clone()];
        device.class = TrackedDeviceClass::Invalid;
        assert!(store_device(&mut devices, &device));
        assert!(!store_device(&mut devices, &device));

        device.class = TrackedDeviceClass::Controller;
        device.serial_number = Some("new session device".into());
        assert!(store_device(&mut devices, &device));
        assert!(!store_device(&mut devices, &device));
        assert_eq!(devices.len(), 1);
        assert!(devices[0] == device);
    }

    #[test]
    fn missing_optional_properties_replace_the_previous_values() {
        let device = snapshot();
        let mut devices = vec![device];
        let missing: OVRDevice = serde_json::from_value(serde_json::json!({
            "index": 7, "class": "Controller", "role": "LeftHand"
        }))
        .unwrap();
        assert!(store_device(&mut devices, &missing));
        assert!(!store_device(&mut devices, &missing));
        assert!(devices[0] == missing);
    }

    #[tokio::test]
    async fn shutdown_clears_device_caches_and_allows_immediate_refresh() {
        OVR_DEVICES.lock().await.push(serde_json::from_value(serde_json::json!({
            "index": 7, "class": "Controller", "role": "LeftHand", "serialNumber": "previous-session"
        })).unwrap());
        DEVICE_CLASS_CACHE
            .lock()
            .await
            .insert(7, TrackedDeviceClass::Controller);
        DEVICE_HANDLE_TYPE_CACHE
            .lock()
            .await
            .insert(7, OVRHandleType::HandPrimary);
        *NEXT_DEVICE_REFRESH.lock().await = Utc::now() + Duration::seconds(5);

        for _ in 0..2 {
            on_ovr_quit().await;
            assert!(get_devices().await.is_empty());
            assert!(DEVICE_CLASS_CACHE.lock().await.is_empty());
            assert!(DEVICE_HANDLE_TYPE_CACHE.lock().await.is_empty());
            assert!(*NEXT_DEVICE_REFRESH.lock().await < Utc::now());
        }
    }
}
