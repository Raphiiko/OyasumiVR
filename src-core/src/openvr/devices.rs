use super::models::{DeviceUpdateEvent, OVRDevice, OVRDevicePose, OpenVRInputEvent};
use super::{GestureDetector, SleepDetector, OVR_CONTEXT};
use crate::utils::send_event;
use byteorder::{ByteOrder, LE};
use chrono::{Duration, NaiveDateTime, Utc};
use log::error;
use ovr::input::InputValueHandle;
use ovr_overlay as ovr;
use tokio::sync::Mutex;

lazy_static! {
    static ref OVR_DEVICES: Mutex<Vec<OVRDevice>> = Mutex::new(Vec::new());
    static ref SLEEP_DETECTOR: Mutex<SleepDetector> = Mutex::new(SleepDetector::new());
    static ref GESTURE_DETECTOR: Mutex<GestureDetector> = Mutex::new(GestureDetector::new());
    static ref NEXT_DEVICE_REFRESH: Mutex<NaiveDateTime> =
        Mutex::new(NaiveDateTime::from_timestamp_millis(0).unwrap());
}

pub async fn on_ovr_tick() {
    // Refresh all devices when needed
    let mut next_device_refresh = NEXT_DEVICE_REFRESH.lock().await;
    if (Utc::now().naive_utc() - *next_device_refresh).num_milliseconds() > 0 {
        *next_device_refresh = Utc::now().naive_utc() + Duration::seconds(5);
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

    let device = OVRDevice {
        index: device_index.0,
        class: system.get_tracked_device_class(device_index).into(),
        battery,
        provides_battery_status,
        can_power_off,
        is_charging,
        dongle_id,
        serial_number,
        hardware_revision,
        manufacturer_name,
        model_number,
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

async fn detect_inputs<'a>() {
    // Get known actions and action sets
    let actions = super::OVR_ACTIONS.lock().await;
    let mut active_sets = super::OVR_ACTIVE_SETS.lock().await;
    // Get input context
    let context = OVR_CONTEXT.lock().await;
    let mut input = match context.as_ref() {
        Some(context) => context.input_mngr(),
        None => return,
    };
    // Update actions for all sets
    if let Err(e) = input.update_actions(active_sets.as_mut_slice()) {
        error!("[Core] Failed to update actions: {:?}", e.description());
        return;
    }
    for action in actions.iter() {
        match input.get_digital_action_data(
            action.handle,
            InputValueHandle(ovr::sys::k_ulInvalidInputValueHandle),
        ) {
            Ok(data) => {
                if data.0.bChanged {
                    let event = OpenVRInputEvent {
                        action: action.name.clone(),
                        pressed: data.0.bState,
                        time_ago: data.0.fUpdateTime,
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
