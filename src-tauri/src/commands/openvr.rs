use openvr::{TrackedDeviceIndex, MAX_TRACKED_DEVICE_COUNT};
use oyasumi_shared::models::OVRDevice;

use crate::{OVR_CONTEXT, OVR_STATUS};

#[tauri::command]
pub fn openvr_get_devices() -> Result<Vec<OVRDevice>, String> {
    let context_guard = OVR_CONTEXT.lock().unwrap();
    let context = match context_guard.as_ref() {
        Some(ctx) => ctx,
        None => return Err("ERROR_OVR_NOT_INITIALIZED".into()),
    };
    let mut devices: Vec<OVRDevice> = Vec::new();
    let system = context.system().unwrap();
    for device_index in 0..(MAX_TRACKED_DEVICE_COUNT as TrackedDeviceIndex) {
        let device_class = match system.tracked_device_class(device_index) {
            openvr::TrackedDeviceClass::Invalid => continue,
            other => other,
        };
        devices.push(OVRDevice {
            index: device_index,
            class: device_class,
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
                .bool_tracked_device_property(device_index, openvr::property::DeviceIsCharging_Bool)
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
                .string_tracked_device_property(device_index, openvr::property::SerialNumber_String)
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
                .string_tracked_device_property(device_index, openvr::property::ModelNumber_String)
                .ok()
            {
                Some(value) => Some(value.into_string().unwrap()),
                None => None,
            },
        })
    }
    Ok(devices)
}

#[tauri::command]
pub async fn openvr_status() -> String {
    OVR_STATUS.lock().unwrap().clone()
}