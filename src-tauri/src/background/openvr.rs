use std::{thread, time::Duration};

use crate::{OVR_STATUS, TAURI_WINDOW};
use openvr::{system as ovrsys, TrackedDeviceIndex};
use openvr_sys::{HmdQuaternion_t, HmdVector3_t};
use oyasumi_shared::models::{DeviceUpdateEvent, OVRDevice, OVRDevicePose};
use tauri::Manager;

use crate::OVR_CONTEXT;

pub fn spawn_openvr_background_thread() {
    thread::spawn(move || 'bgLoop: loop {
        loop {
            thread::sleep(Duration::from_millis(50));
            let context_guard = OVR_CONTEXT.lock().unwrap();
            let context = context_guard.as_ref().unwrap();
            let window_guard = TAURI_WINDOW.lock().unwrap();
            let window = window_guard.as_ref().unwrap();

            let system = context.system().unwrap();

            // Poll for device poses
            let poses = system
                .device_to_absolute_tracking_pose(openvr::TrackingUniverseOrigin::Standing, 0.0);
            for n in 0..poses.len() {
                let pose = poses[n];
                if pose.device_is_connected() && pose.pose_is_valid() {
                    let matrix = pose.device_to_absolute_tracking().clone();
                    // Extract quaternion
                    let q = HmdQuaternion_t {
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
                    let pos: HmdVector3_t = HmdVector3_t {
                        v: [matrix[0][3], matrix[1][3], matrix[2][3]],
                    };
                    // Emit event
                    window
                        .emit_all(
                            "OVR_POSE_UPDATE",
                            OVRDevicePose {
                                index: n as u32,
                                quaternion: [q.x, q.y, q.z, q.w],
                                position: pos.v,
                            },
                        )
                        .ok();
                }
            }

            // Poll for property updates
            if let Some((event_info, _)) =
                system.poll_next_event_with_pose(openvr::TrackingUniverseOrigin::Standing)
            {
                let send_device_update = |device_index: TrackedDeviceIndex| {
                    let event = DeviceUpdateEvent {
                        device: OVRDevice {
                            index: device_index,
                            class: system.tracked_device_class(device_index),
                            battery: system
                                .float_tracked_device_property(
                                    device_index,
                                    openvr::property::DeviceBatteryPercentage_Float,
                                )
                                .ok(),
                            provides_battery_status: system
                                .bool_tracked_device_property(
                                    device_index,
                                    openvr::property::DeviceProvidesBatteryStatus_Bool,
                                )
                                .ok(),
                            can_power_off: system
                                .bool_tracked_device_property(
                                    device_index,
                                    openvr::property::DeviceCanPowerOff_Bool,
                                )
                                .ok(),
                            is_charging: system
                                .bool_tracked_device_property(
                                    device_index,
                                    openvr::property::DeviceIsCharging_Bool,
                                )
                                .ok(),
                            dongle_id: match system
                                .string_tracked_device_property(
                                    device_index,
                                    openvr::property::ConnectedWirelessDongle_String,
                                )
                                .ok()
                            {
                                Some(value) => Some(value.into_string().unwrap()),
                                None => None,
                            },
                            serial_number: match system
                                .string_tracked_device_property(
                                    device_index,
                                    openvr::property::SerialNumber_String,
                                )
                                .ok()
                            {
                                Some(value) => Some(value.into_string().unwrap()),
                                None => None,
                            },
                            hardware_revision: match system
                                .string_tracked_device_property(
                                    device_index,
                                    openvr::property::HardwareRevision_String,
                                )
                                .ok()
                            {
                                Some(value) => Some(value.into_string().unwrap()),
                                None => None,
                            },
                            manufacturer_name: match system
                                .string_tracked_device_property(
                                    device_index,
                                    openvr::property::ManufacturerName_String,
                                )
                                .ok()
                            {
                                Some(value) => Some(value.into_string().unwrap()),
                                None => None,
                            },
                            model_number: match system
                                .string_tracked_device_property(
                                    device_index,
                                    openvr::property::ModelNumber_String,
                                )
                                .ok()
                            {
                                Some(value) => Some(value.into_string().unwrap()),
                                None => None,
                            },
                        },
                    };
                    window.emit_all("OVR_DEVICE_UPDATE", event).unwrap();
                };
                if match event_info.event {
                    ovrsys::Event::Quit(_) => {
                        unsafe {
                            context.system().unwrap().acknowledge_quit_exiting();
                            context.shutdown();
                        }
                        *OVR_STATUS.lock().unwrap() = String::from("QUIT");
                        window.emit_all("OVR_QUIT", ()).unwrap();
                        true
                    }
                    ovrsys::Event::TrackedDeviceActivated
                    | ovrsys::Event::TrackedDeviceDeactivated => {
                        send_device_update(event_info.tracked_device_index);
                        false
                    }
                    ovrsys::Event::PropertyChanged(prop) => match prop.property {
                        openvr::property::DeviceBatteryPercentage_Float
                        | openvr::property::DeviceProvidesBatteryStatus_Bool
                        | openvr::property::DeviceCanPowerOff_Bool
                        | openvr::property::DeviceIsCharging_Bool
                        | openvr::property::ConnectedWirelessDongle_String
                        | openvr::property::SerialNumber_String
                        | openvr::property::HardwareRevision_String
                        | openvr::property::ManufacturerName_String
                        | openvr::property::ModelNumber_String => {
                            send_device_update(event_info.tracked_device_index);
                            false
                        }
                        _ => false,
                    },
                    _ => false,
                } {
                    break 'bgLoop;
                }
            }
            drop(context);
            drop(window);
        }
    });
}
