use std::{thread, time::Duration};

use crate::{
    models::{DeviceUpdateEvent, OVRDevice},
    TAURI_WINDOW, OVR_STATUS,
};
use openvr::{system as ovrsys, TrackedDeviceIndex};
use tauri::Manager;

use crate::OVR_CONTEXT;

pub fn spawn_openvr_background_thread() {
    thread::spawn(move || 'bgLoop: loop {
        loop {
            let context_guard = OVR_CONTEXT.lock().unwrap();
            let context = context_guard.as_ref().unwrap();
            let system = context.system().unwrap();
            if let Some((event_info, _)) =
                system.poll_next_event_with_pose(openvr::TrackingUniverseOrigin::RawAndUncalibrated)
            {
                // if event_info.tracked_device_index > 0
                //     && event_info.tracked_device_index
                //         < openvr::MAX_TRACKED_DEVICE_COUNT.try_into().unwrap()
                // {
                //     println!(
                //         "[device_id:{}] {:?} {:?}",
                //         event_info.tracked_device_index,
                //         system.tracked_device_class(event_info.tracked_device_index),
                //         event_info.event
                //     );
                // }
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
                    let window_guard = TAURI_WINDOW.lock().unwrap();
                    let window = window_guard.as_ref().unwrap();
                    window.emit_all("OVR_DEVICE_UPDATE", event).unwrap();
                };
                if match event_info.event {
                    ovrsys::Event::Quit(_) => {
                        unsafe {
                            context.system().unwrap().acknowledge_quit_exiting();
                            context.shutdown();
                        }
                        *OVR_STATUS.lock().unwrap() = String::from("QUIT");
                        let window_guard = TAURI_WINDOW.lock().unwrap();
                        let window = window_guard.as_ref().unwrap();
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
                drop(context);
            } else {
                drop(context);
                break;
            }
            thread::sleep(Duration::from_millis(16));
        }
    });
}
