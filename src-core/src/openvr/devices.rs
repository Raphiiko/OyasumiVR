use std::collections::HashMap;

use super::models::{
    DeviceUpdateEvent, OVRDevice, OVRDevicePose, OVRHandleType, OpenVRInputEvent,
    TrackedDeviceClass,
};
use super::{GestureDetector, SleepDetector, OVR_CONTEXT};
use crate::utils::send_event;
use chrono::{DateTime, Duration, Utc};
use log::error;
use openvr::errors::VRInputError;
use openvr::input::VRInputValueHandle;
use openvr::system::{DeviceActivityLevel, EventInfo};
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

pub async fn on_ovr_event(event: EventInfo) {
    match event.event {
        openvr::system::Event::TrackedDeviceActivated
        | openvr::system::Event::TrackedDeviceDeactivated => {
            update_device(event.tracked_device_index, true).await;
        }
        openvr::system::Event::PropertyChanged(v) => {
            let matching_properties: [openvr_sys::TrackedDeviceProperty; 9] = [
                openvr_sys::ETrackedDeviceProperty_Prop_DeviceBatteryPercentage_Float,
                openvr_sys::ETrackedDeviceProperty_Prop_DeviceProvidesBatteryStatus_Bool,
                openvr_sys::ETrackedDeviceProperty_Prop_DeviceCanPowerOff_Bool,
                openvr_sys::ETrackedDeviceProperty_Prop_DeviceIsCharging_Bool,
                openvr_sys::ETrackedDeviceProperty_Prop_ConnectedWirelessDongle_String,
                openvr_sys::ETrackedDeviceProperty_Prop_SerialNumber_String,
                openvr_sys::ETrackedDeviceProperty_Prop_HardwareRevision_String,
                openvr_sys::ETrackedDeviceProperty_Prop_ManufacturerName_String,
                openvr_sys::ETrackedDeviceProperty_Prop_ModelNumber_String,
            ];
            if matching_properties.contains(&v.property.0) {
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
        Some(context) => context.input().unwrap(),
        None => return,
    };

    let action_handle = match input.get_input_source_handle(handle_type.as_action_handle()) {
        Ok(handle) => handle,
        Err(err) => {
            error!(
                "[Core] Unable to get action handle by name {}: {:?}",
                handle_type.as_action_handle(),
                err
            ); // shouldn't happen but log just in case
            return;
        }
    };

    let device_info = match input.get_origin_tracked_device_info(action_handle) {
        Ok(info) => info,
        Err(err) => {
            // expected errors
            if err == VRInputError::NoData || err == VRInputError::InvalidHandle {
                return;
            }
            error!(
                "[Core] Unable to get device info for handle {}: {:?}",
                handle_type.as_action_handle(),
                err
            ); // unexpected error
            return;
        }
    };
    device_handle_cache.insert(device_info.0.trackedDeviceIndex, handle_type);
}

async fn update_all_devices(emit: bool) {
    for n in 0..(openvr_sys::k_unMaxTrackedDeviceCount as usize) {
        update_device(openvr::TrackedDeviceIndex(n.try_into().unwrap()), emit).await;
    }
}

async fn update_device(device_index: openvr::TrackedDeviceIndex, emit: bool) {
    let context = OVR_CONTEXT.lock().await;
    let system = match context.as_ref() {
        Some(context) => context.system().unwrap(),
        None => return,
    };
    let class: TrackedDeviceClass = system.tracked_device_class(device_index).into();
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
        .get_tracked_device_property_f32(
            device_index,
            openvr_sys::ETrackedDeviceProperty_Prop_DeviceBatteryPercentage_Float,
        )
        .ok();
    let provides_battery_status: Option<bool> = system
        .get_tracked_device_property_bool(
            device_index,
            openvr_sys::ETrackedDeviceProperty_Prop_DeviceProvidesBatteryStatus_Bool,
        )
        .ok();
    let can_power_off: Option<bool> = system
        .get_tracked_device_property_bool(
            device_index,
            openvr_sys::ETrackedDeviceProperty_Prop_DeviceCanPowerOff_Bool,
        )
        .ok();
    let is_charging: Option<bool> = system
        .get_tracked_device_property_bool(
            device_index,
            openvr_sys::ETrackedDeviceProperty_Prop_DeviceIsCharging_Bool,
        )
        .ok();
    let dongle_id: Option<String> = system
        .get_tracked_device_property_string(
            device_index,
            openvr_sys::ETrackedDeviceProperty_Prop_ConnectedWirelessDongle_String,
        )
        .ok();
    let serial_number: Option<String> = system
        .get_tracked_device_property_string(
            device_index,
            openvr_sys::ETrackedDeviceProperty_Prop_SerialNumber_String,
        )
        .ok();
    let hardware_revision: Option<String> = system
        .get_tracked_device_property_string(
            device_index,
            openvr_sys::ETrackedDeviceProperty_Prop_HardwareRevision_String,
        )
        .ok();
    let manufacturer_name: Option<String> = system
        .get_tracked_device_property_string(
            device_index,
            openvr_sys::ETrackedDeviceProperty_Prop_ManufacturerName_String,
        )
        .ok();
    let model_number: Option<String> = system
        .get_tracked_device_property_string(
            device_index,
            openvr_sys::ETrackedDeviceProperty_Prop_ModelNumber_String,
        )
        .ok();
    let mut hmd_on_head = None;
    let mut hmd_activity = None;
    let mut display_frequency = None;
    if class == TrackedDeviceClass::HMD {
        let activity_level = system.get_tracked_device_activity_level(device_index);
        hmd_on_head = Some(
            activity_level == DeviceActivityLevel::UserInteraction
                || activity_level == DeviceActivityLevel::UserInteractionTimeout,
        );
        // Serialize activity level
        hmd_activity = Some(
            match activity_level {
                DeviceActivityLevel::Unknown => "Unknown",
                DeviceActivityLevel::Idle => "Idle",
                DeviceActivityLevel::UserInteraction => "UserInteraction",
                DeviceActivityLevel::UserInteractionTimeout => "UserInteractionTimeout",
                DeviceActivityLevel::Standby => "Standby",
                DeviceActivityLevel::IdleTimeout => "IdleTimeout",
            }
            .to_string(),
        );
        display_frequency = system
            .get_tracked_device_property_f32(
                device_index,
                openvr_sys::ETrackedDeviceProperty_Prop_DisplayFrequency_Float,
            )
            .ok();
    }

    let device = OVRDevice {
        index: device_index.0,
        class,
        role: system
            .get_controller_role_for_tracked_device_index(device_index)
            .unwrap()
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

async fn refresh_device_poses() {
    let poses = {
        let context = OVR_CONTEXT.lock().await;
        let system = match context.as_ref() {
            Some(context) => context.system().unwrap(),
            None => return,
        };
        system.device_to_absolute_tracking_pose(openvr::TrackingUniverseOrigin::Standing, 0.0)
    };
    for (n, pose) in poses.iter().enumerate() {
        if pose.0.bDeviceIsConnected && pose.0.bPoseIsValid {
            let matrix = pose.0.mDeviceToAbsoluteTracking.m;
            // Extract quaternion
            let q = openvr_sys::HmdQuaternion_t {
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
            let pos = openvr_sys::HmdVector3_t {
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
    // Get known devices, and input
    let devices = OVR_DEVICES.lock().await;
    let mut input_ctx = super::OVR_INPUT_CONTEXT.lock().await;
    // Get input context
    let context = OVR_CONTEXT.lock().await;
    let mut input = match context.as_ref() {
        Some(context) => context.input().unwrap(),
        None => return,
    };
    // Update actions for all sets
    if let Err(e) = input.update_actions(input_ctx.active_sets.as_mut_slice()) {
        error!("[Core] Failed to update actions: {:?}", e);
        return;
    }
    for action in input_ctx.actions.iter() {
        match input.get_digital_action_data(
            action.handle,
            VRInputValueHandle(openvr_sys::k_ulInvalidInputValueHandle),
        ) {
            Ok(data) => {
                if data.0.bChanged {
                    let handle = VRInputValueHandle(data.0.activeOrigin);
                    let device = match input.get_origin_tracked_device_info(handle) {
                        Ok(r) => devices
                            .iter()
                            .find(|d| d.index == r.0.trackedDeviceIndex)
                            .cloned(),
                        Err(e) => {
                            error!("[Core] Failed to get origin tracked device info: {:?}", e);
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
                error!("[Core] Failed to get action data: {:?}", e);
                return;
            }
        };
    }
}
