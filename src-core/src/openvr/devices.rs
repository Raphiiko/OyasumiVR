use std::collections::HashMap;

use super::models::{
    DeviceUpdateEvent, OVRDevice, OVRDevicePose, OVRHandleType, OpenVRInputEvent,
    TrackedDeviceClass,
};
use super::{GestureDetector, SleepDetector, OVR_CONTEXT};
use crate::utils::send_event;
use byteorder::{ByteOrder, LE};
use chrono::{DateTime, Duration, Utc};
use log::error;
use ovr::input::InputValueHandle;
use ovr::sys::EVRInputError;
use ovr_overlay as ovr;
use strum::IntoEnumIterator;
use tokio::sync::Mutex;

lazy_static! {
    static ref OVR_DEVICES: Mutex<Vec<OVRDevice>> = Mutex::new(Vec::new());
    static ref SLEEP_DETECTOR: Mutex<SleepDetector> = Mutex::new(SleepDetector::new());
    static ref GESTURE_DETECTOR: Mutex<GestureDetector> = Mutex::new(GestureDetector::new());
    static ref NEXT_DEVICE_REFRESH: Mutex<DateTime::<Utc>> =
        Mutex::new(DateTime::from_timestamp_millis(0).unwrap());
    static ref NEXT_POSE_BROADCAST: Mutex<DateTime::<Utc>> =
        Mutex::new(DateTime::from_timestamp_millis(0).unwrap());
    static ref DEVICE_CLASS_CACHE: Mutex<HashMap<u32, TrackedDeviceClass>> =
        Mutex::new(HashMap::new());
    static ref DEVICE_HANDLE_TYPE_CACHE: Mutex<HashMap<u32, OVRHandleType>> =
        Mutex::new(HashMap::new());
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
    match event.event_type {
        ovr::sys::EVREventType::VREvent_TrackedDeviceActivated
        | ovr::sys::EVREventType::VREvent_TrackedDeviceDeactivated => {
            update_device(event.tracked_device_index, true).await;
        }
        ovr::sys::EVREventType::VREvent_PropertyChanged => {
            let tracked_device_property: u32 = LE::read_u32(&event.data[12..16]);
            let matching_properties = [
                ovr::sys::ETrackedDeviceProperty::Prop_DeviceBatteryPercentage_Float as u32,
                ovr::sys::ETrackedDeviceProperty::Prop_DeviceProvidesBatteryStatus_Bool as u32,
                ovr::sys::ETrackedDeviceProperty::Prop_DeviceCanPowerOff_Bool as u32,
                ovr::sys::ETrackedDeviceProperty::Prop_DeviceIsCharging_Bool as u32,
                ovr::sys::ETrackedDeviceProperty::Prop_ConnectedWirelessDongle_String as u32,
                ovr::sys::ETrackedDeviceProperty::Prop_SerialNumber_String as u32,
                ovr::sys::ETrackedDeviceProperty::Prop_HardwareRevision_String as u32,
                ovr::sys::ETrackedDeviceProperty::Prop_ManufacturerName_String as u32,
                ovr::sys::ETrackedDeviceProperty::Prop_ModelNumber_String as u32,
            ];
            if matching_properties.contains(&tracked_device_property) {
                update_device(event.tracked_device_index, true).await;
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
    let mut input = match context.as_ref() {
        Some(context) => context.input_mngr(),
        None => return,
    };

    let action_handle = match input.get_input_source_handle(&handle_type.as_action_handle()) {
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

async fn update_all_devices<'a>(emit: bool) {
    for n in 0..(ovr::sys::k_unMaxTrackedDeviceCount as usize) {
        update_device(ovr::TrackedDeviceIndex(n.try_into().unwrap()), emit).await;
    }
}

async fn update_device<'a>(device_index: ovr::TrackedDeviceIndex, emit: bool) {
    let context = OVR_CONTEXT.lock().await;
    let mut system = match context.as_ref() {
        Some(context) => context.system_mngr(),
        None => return,
    };
    let class: TrackedDeviceClass = system.get_tracked_device_class(device_index).into();
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

    let handle_type: Option<OVRHandleType> = device_handle_cache
        .get(&device_index.0)
        .map(|it| it.clone());
    drop(device_handle_cache);
    // Get device properties
    let battery: Option<f32> = system
        .get_tracked_device_property(
            device_index,
            ovr::sys::ETrackedDeviceProperty::Prop_DeviceBatteryPercentage_Float,
        )
        .ok();
    let provides_battery_status: Option<bool> = system
        .get_tracked_device_property(
            device_index,
            ovr::sys::ETrackedDeviceProperty::Prop_DeviceProvidesBatteryStatus_Bool,
        )
        .ok();
    let can_power_off: Option<bool> = system
        .get_tracked_device_property(
            device_index,
            ovr::sys::ETrackedDeviceProperty::Prop_DeviceCanPowerOff_Bool,
        )
        .ok();
    let is_charging: Option<bool> = system
        .get_tracked_device_property(
            device_index,
            ovr::sys::ETrackedDeviceProperty::Prop_DeviceIsCharging_Bool,
        )
        .ok();
    let dongle_id: Option<String> = system
        .get_tracked_device_property(
            device_index,
            ovr::sys::ETrackedDeviceProperty::Prop_ConnectedWirelessDongle_String,
        )
        .ok();
    let serial_number: Option<String> = system
        .get_tracked_device_property(
            device_index,
            ovr::sys::ETrackedDeviceProperty::Prop_SerialNumber_String,
        )
        .ok();
    let hardware_revision: Option<String> = system
        .get_tracked_device_property(
            device_index,
            ovr::sys::ETrackedDeviceProperty::Prop_HardwareRevision_String,
        )
        .ok();
    let manufacturer_name: Option<String> = system
        .get_tracked_device_property(
            device_index,
            ovr::sys::ETrackedDeviceProperty::Prop_ManufacturerName_String,
        )
        .ok();
    let model_number: Option<String> = system
        .get_tracked_device_property(
            device_index,
            ovr::sys::ETrackedDeviceProperty::Prop_ModelNumber_String,
        )
        .ok();
    let mut hmd_on_head = None;
    let mut debug_hmd_activity = None;
    if class == TrackedDeviceClass::HMD {
        let activity_level = system.get_tracked_device_activity_level(device_index);
        hmd_on_head = Some(activity_level == ovr::sys::EDeviceActivityLevel::k_EDeviceActivityLevel_UserInteraction || activity_level == ovr::sys::EDeviceActivityLevel::k_EDeviceActivityLevel_UserInteraction_Timeout);
        // Serialize activity level
        debug_hmd_activity = Some(
            match activity_level {
                ovr::sys::EDeviceActivityLevel::k_EDeviceActivityLevel_Unknown => "Unknown",
                ovr::sys::EDeviceActivityLevel::k_EDeviceActivityLevel_Idle => "Idle",
                ovr::sys::EDeviceActivityLevel::k_EDeviceActivityLevel_UserInteraction => {
                    "UserInteraction"
                }
                ovr::sys::EDeviceActivityLevel::k_EDeviceActivityLevel_UserInteraction_Timeout => {
                    "UserInteractionTimeout"
                }
                ovr::sys::EDeviceActivityLevel::k_EDeviceActivityLevel_Standby => "Standby",
                ovr::sys::EDeviceActivityLevel::k_EDeviceActivityLevel_Idle_Timeout => {
                    "IdleTimeout"
                }
            }
            .to_string(),
        );
    }

    let device = OVRDevice {
        index: device_index.0,
        class,
        role: system
            .get_controller_role_for_tracked_device_index(device_index)
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
        debug_hmd_activity,
    };

    // Add or update device in list
    let mut devices = OVR_DEVICES.lock().await;
    let mut found = false;
    for i in 0..devices.len() {
        if devices[i].index == device_index.0 {
            devices[i] = device.clone();
            found = true;
            break;
        }
    }
    if !found {
        devices.push(device.clone());
    }
    // Send out device update as an event
    if emit {
        let event = DeviceUpdateEvent { device };
        send_event("OVR_DEVICE_UPDATE", event).await;
    }
}

async fn refresh_device_poses<'a>() {
    let poses = {
        let context = OVR_CONTEXT.lock().await;
        let mut system = match context.as_ref() {
            Some(context) => context.system_mngr(),
            None => return,
        };
        system.get_device_to_absolute_tracking_pose(
            ovr::sys::ETrackingUniverseOrigin::TrackingUniverseStanding,
            0.0,
        )
    };
    for (n, pose) in poses.iter().enumerate() {
        if pose.bDeviceIsConnected && pose.bPoseIsValid {
            let matrix = pose.mDeviceToAbsoluteTracking.m;
            // Extract quaternion
            let q = ovr::sys::HmdQuaternion_t {
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
            let pos = ovr::sys::HmdVector3_t {
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

async fn detect_inputs<'a>() {
    // Get known devices, and input
    let devices = OVR_DEVICES.lock().await;
    let mut input_ctx = super::OVR_INPUT_CONTEXT.lock().await;
    // Get input context
    let context = OVR_CONTEXT.lock().await;
    let mut input = match context.as_ref() {
        Some(context) => context.input_mngr(),
        None => return,
    };
    // Update actions for all sets
    if let Err(e) = input.update_actions(input_ctx.active_sets.as_mut_slice()) {
        error!("[Core] Failed to update actions: {:?}", e.description());
        return;
    }
    for action in input_ctx.actions.iter() {
        match input.get_digital_action_data(
            action.handle,
            InputValueHandle(ovr::sys::k_ulInvalidInputValueHandle),
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
                                e.description()
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
                error!("[Core] Failed to get action data: {:?}", e.description());
                return;
            }
        };
    }
}
