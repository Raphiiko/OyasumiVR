pub mod commands;
mod gesture_detector;
mod models;
mod sleep_detector;

use std::{ffi::CStr, sync::Arc, time::Duration};

use chrono::{naive::NaiveDateTime, Utc};
use log::info;
use models::OpenVRStatus;
use openvr::TrackedDeviceIndex;
use openvr_sys::k_pch_SteamVR_Section;
use oyasumi_shared::models::{DeviceUpdateEvent, OVRDevice, OVRDevicePose};
use sleep_detector::SleepDetector;
use substring::Substring;
use tokio::sync::Mutex;

use gesture_detector::GestureDetector;

use crate::utils::send_event;

lazy_static! {
    static ref OPENVR_MANAGER: Mutex<Option<OpenVRManager>> = Default::default();
}

pub async fn init() {
    let manager = OpenVRManager::new();
    manager.set_active(true).await;
    *OPENVR_MANAGER.lock().await = Some(manager);
}

#[derive(Clone)]
pub struct OpenVRManager {
    active: Arc<Mutex<bool>>,
    status: Arc<Mutex<OpenVRStatus>>,
    devices: Arc<Mutex<Vec<OVRDevice>>>,
    settings: Arc<Mutex<Option<openvr::Settings>>>,
    gesture_detector: Arc<Mutex<GestureDetector>>,
    sleep_detector: Arc<Mutex<SleepDetector>>,
}

impl OpenVRManager {
    pub fn new() -> OpenVRManager {
        let manager = OpenVRManager {
            active: Arc::new(Mutex::new(false)),
            status: Arc::new(Mutex::new(OpenVRStatus::Inactive)),
            devices: Arc::new(Mutex::new(vec![])),
            settings: Arc::new(Mutex::new(None)),
            gesture_detector: Arc::new(Mutex::new(GestureDetector::new())),
            sleep_detector: Arc::new(Mutex::new(SleepDetector::new())),
        };
        let mut manager_clone = manager.clone();
        tokio::spawn(async move {
            manager_clone.init().await;
        });
        manager
    }

    pub async fn get_devices(&self) -> Vec<OVRDevice> {
        let devices = self.devices.lock().await;
        devices.clone()
    }

    pub async fn get_status(&self) -> OpenVRStatus {
        let status = self.status.lock().await;
        status.clone()
    }

    pub async fn set_active(&self, active: bool) {
        let mut _active = self.active.lock().await;
        *_active = active;
    }

    pub async fn get_analog_gain(&self) -> Result<f32, String> {
        let mut devices = self.devices.lock().await;
        let device = devices
            .iter_mut()
            .find(|device| device.class == openvr::TrackedDeviceClass::HMD);
        if device.is_some() {
            // TODO: CHECK IF HMD SUPPORTS ANALOG GAIN
            let settings = self.settings.lock().await;
            if settings.is_some() {
                let analog_gain = settings.as_ref().unwrap().get_float(
                    CStr::from_bytes_with_nul(k_pch_SteamVR_Section).unwrap(),
                    CStr::from_bytes_with_nul(b"analogGain\0").unwrap(),
                );
                match analog_gain {
                    Ok(analog_gain) => Ok(analog_gain),
                    Err(_) => Err("ANALOG_GAIN_NOT_FOUND".to_string()),
                }
            } else {
                Err("OPENVR_NOT_INITIALISED".to_string())
            }
        } else {
            Err("NO_HMD_FOUND".to_string())
        }
    }

    pub async fn set_analog_gain(&self, analog_gain: f32) -> Result<(), String> {
        let mut devices = self.devices.lock().await;
        let device = devices
            .iter_mut()
            .find(|device| device.class == openvr::TrackedDeviceClass::HMD);
        if device.is_some() {
            // TODO: CHECK IF HMD SUPPORTS ANALOG GAIN
            let settings = self.settings.lock().await;
            if settings.is_some() {
                let _ = settings.as_ref().unwrap().set_float(
                    CStr::from_bytes_with_nul(k_pch_SteamVR_Section).unwrap(),
                    CStr::from_bytes_with_nul(b"analogGain\0").unwrap(),
                    analog_gain,
                );
            } else {
                return Err("OPENVR_NOT_INITIALISED".to_string());
            }
            Ok(())
        } else {
            Err("NO_HMD_FOUND".to_string())
        }
    }

    pub async fn get_supersample_scale(&self) -> Result<Option<f32>, String> {
        let settings = self.settings.lock().await;
        if settings.is_none() {
            return Err("OPENVR_NOT_INITIALISED".to_string());
        }
        let supersample_manual_override = settings.as_ref().unwrap().get_bool(
            CStr::from_bytes_with_nul(k_pch_SteamVR_Section).unwrap(),
            CStr::from_bytes_with_nul(b"supersampleManualOverride\0").unwrap(),
        );
        let supersample_manual_override = match supersample_manual_override {
            Ok(supersample_manual_override) => supersample_manual_override,
            Err(_) => return Err("SUPERSAMPLE_MANUAL_OVERRIDE_NOT_FOUND".to_string()),
        };
        // Supersampling is set to auto
        if !supersample_manual_override {
            return Ok(None);
        }
        // Supersampling is set to custom
        let supersample_scale = settings.as_ref().unwrap().get_float(
            CStr::from_bytes_with_nul(k_pch_SteamVR_Section).unwrap(),
            CStr::from_bytes_with_nul(b"supersampleScale\0").unwrap(),
        );
        match supersample_scale {
            Ok(supersample_scale) => Ok(Some(supersample_scale)),
            Err(_) => Err("SUPERSAMPLE_SCALE_NOT_FOUND".to_string()),
        }
    }

    pub async fn set_supersample_scale(
        &self,
        supersample_scale: Option<f32>,
    ) -> Result<(), String> {
        let settings = self.settings.lock().await;
        if settings.is_some() {
            let _ = settings.as_ref().unwrap().set_bool(
                CStr::from_bytes_with_nul(k_pch_SteamVR_Section).unwrap(),
                CStr::from_bytes_with_nul(b"supersampleManualOverride\0").unwrap(),
                supersample_scale.is_some(),
            );
            if supersample_scale.is_some() {
                let _ = settings.as_ref().unwrap().set_float(
                    CStr::from_bytes_with_nul(k_pch_SteamVR_Section).unwrap(),
                    CStr::from_bytes_with_nul(b"supersampleScale\0").unwrap(),
                    supersample_scale.unwrap(),
                );
            }
        } else {
            return Err("OPENVR_NOT_INITIALISED".to_string());
        }
        Ok(())
    }

    pub async fn init(&mut self) {
        // Task state
        let mut ovr_active = false;
        let mut ovr_next_init = NaiveDateTime::from_timestamp_millis(0).unwrap();
        let mut ovr_next_device_refresh = NaiveDateTime::from_timestamp_millis(0).unwrap();
        let mut ovr_context: Option<openvr::Context> = None;
        let mut ovr_system: Option<openvr::System> = None;

        // Main Loop
        'ovr_loop: loop {
            tokio::time::sleep(Duration::from_millis(32)).await;
            let state_active = self.active.lock().await;
            if *state_active {
                drop(state_active);
                // If we're not active, try to initialize OpenVR
                if ovr_context.is_none() {
                    // Stop if we cannot yet (re)initialize OpenVR
                    if (Utc::now().naive_utc() - ovr_next_init).num_milliseconds() <= 0 {
                        continue;
                    }
                    // If we need to reinitialize OpenVR after this, wait at least 3 seconds
                    ovr_next_init = Utc::now().naive_utc() + chrono::Duration::seconds(3);
                    // Check if SteamVR is running, snd stop initializing if it's not.
                    if !crate::utils::is_process_active("vrmonitor.exe").await {
                        self.update_status(OpenVRStatus::Inactive).await;
                        continue;
                    }
                    // Update the status
                    self.update_status(OpenVRStatus::Initializing).await;
                    // Try to initialize OpenVR
                    unsafe {
                        ovr_context = match openvr::init(openvr::ApplicationType::Background) {
                            Ok(ctx) => Some(ctx),
                            Err(_err) => None,
                        };
                    }
                    // If we failed, continue to try again later
                    if ovr_context.is_none() {
                        continue;
                    }
                    // Obtain the system context
                    ovr_system = match ovr_context.as_mut().unwrap().system() {
                        Ok(sys) => Some(sys),
                        Err(_err) => None,
                    };
                    // If we failed, continue to tryt again later
                    if ovr_system.is_none() {
                        unsafe {
                            ovr_context.unwrap().shutdown();
                        }
                        ovr_context = None;
                        continue;
                    }
                    // Obtain the settings context
                    let ovr_settings = match ovr_context.as_mut().unwrap().settings() {
                        Ok(set) => Some(set),
                        Err(_err) => None,
                    };
                    // If we failed, continue to try again later
                    if ovr_settings.is_none() {
                        unsafe {
                            ovr_context.unwrap().shutdown();
                        }
                        ovr_context = None;
                        ovr_system = None;
                        continue;
                    }
                    // Set the settings context on the state
                    let mut settings_guard = self.settings.lock().await;
                    *settings_guard = ovr_settings;
                    // We've successfully initialized OpenVR
                    info!("[Core] OpenVR Initialized");
                    ovr_active = true;
                    self.update_status(OpenVRStatus::Initialized).await;
                }
                if let Some(system) = ovr_system.as_mut() {
                    // Refresh all devices when needed
                    if (Utc::now().naive_utc() - ovr_next_device_refresh).num_milliseconds() > 0 {
                        ovr_next_device_refresh =
                            Utc::now().naive_utc() + chrono::Duration::seconds(5);
                        self.update_all_devices(true, system).await;
                    }
                    // Update poses
                    self.refresh_device_poses(system).await;
                    // Poll for events
                    while let Some((e, _)) =
                        system.poll_next_event_with_pose(openvr::TrackingUniverseOrigin::Standing)
                    {
                        // Handle Quit event
                        match e.event {
                            openvr::system::event::Event::Quit(_) => {
                                // Shutdown OpenVR
                                info!("[Core] OpenVR is Quitting. Shutting down OpenVR module");
                                ovr_active = false;
                                self.update_status(OpenVRStatus::Inactive).await;
                                unsafe {
                                    ovr_context.unwrap().shutdown();
                                    ovr_context = None;
                                }
                                ovr_system = None;
                                // Schedule next initialization attempt
                                ovr_next_init =
                                    Utc::now().naive_utc() + chrono::Duration::seconds(5);
                                continue 'ovr_loop;
                            }
                            openvr::system::event::Event::TrackedDeviceActivated
                            | openvr::system::event::Event::TrackedDeviceDeactivated => {
                                self.update_device(e.tracked_device_index, true, system)
                                    .await;
                            }
                            openvr::system::event::Event::PropertyChanged(prop) => {
                                if matches!(
                                    prop.property,
                                    openvr::property::DeviceBatteryPercentage_Float
                                        | openvr::property::DeviceProvidesBatteryStatus_Bool
                                        | openvr::property::DeviceCanPowerOff_Bool
                                        | openvr::property::DeviceIsCharging_Bool
                                        | openvr::property::ConnectedWirelessDongle_String
                                        | openvr::property::SerialNumber_String
                                        | openvr::property::HardwareRevision_String
                                        | openvr::property::ManufacturerName_String
                                        | openvr::property::ModelNumber_String
                                ) {
                                    self.update_device(e.tracked_device_index, true, system)
                                        .await;
                                }
                            }
                            _ => {}
                        }
                    }
                }
            } else if ovr_active {
                ovr_active = false;
                info!("[Core] Shutting down OpenVR module");
                self.update_status(OpenVRStatus::Inactive).await;
                // Shutdown OpenVR
                if let Some(ctx) = ovr_context {
                    ovr_system = None;
                    unsafe {
                        ctx.shutdown();
                    }
                    ovr_context = None;
                }
            }
        }
    }

    async fn update_status(&self, new_status: OpenVRStatus) {
        let mut status = self.status.lock().await;
        *status = new_status.clone();
        let status_str = serde_json::to_string(&new_status).unwrap();
        send_event(
            "OVR_STATUS_UPDATE",
            status_str.substring(1, status_str.len() - 1).to_string(),
        )
        .await;
    }

    async fn refresh_device_poses(&mut self, system: &openvr::System) {
        let poses =
            system.device_to_absolute_tracking_pose(openvr::TrackingUniverseOrigin::Standing, 0.0);
        for (n, pose) in poses.iter().enumerate() {
            if pose.device_is_connected() && pose.pose_is_valid() {
                let matrix = *pose.device_to_absolute_tracking();
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
                    self.sleep_detector
                        .lock()
                        .await
                        .log_pose(pos.v, [q.x, q.y, q.z, q.w])
                        .await;
                    self.gesture_detector
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

    async fn update_all_devices(&self, emit: bool, system: &openvr::System) {
        for n in 0..openvr::MAX_TRACKED_DEVICE_COUNT {
            self.update_device(n as u32, emit, system).await;
        }
    }

    async fn update_device(
        &self,
        device_index: TrackedDeviceIndex,
        emit: bool,
        system: &openvr::System,
    ) {
        let device = OVRDevice {
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
                .bool_tracked_device_property(device_index, openvr::property::DeviceIsCharging_Bool)
                .ok(),
            dongle_id: system
                .string_tracked_device_property(
                    device_index,
                    openvr::property::ConnectedWirelessDongle_String,
                )
                .ok()
                .map(|value| value.into_string().unwrap()),
            serial_number: system
                .string_tracked_device_property(device_index, openvr::property::SerialNumber_String)
                .ok()
                .map(|value| value.into_string().unwrap()),
            hardware_revision: system
                .string_tracked_device_property(
                    device_index,
                    openvr::property::HardwareRevision_String,
                )
                .ok()
                .map(|value| value.into_string().unwrap()),
            manufacturer_name: system
                .string_tracked_device_property(
                    device_index,
                    openvr::property::ManufacturerName_String,
                )
                .ok()
                .map(|value| value.into_string().unwrap()),
            model_number: system
                .string_tracked_device_property(device_index, openvr::property::ModelNumber_String)
                .ok()
                .map(|value| value.into_string().unwrap()),
        };

        // Add or update device in list
        let mut devices = self.devices.lock().await;
        let mut found = false;
        for i in 0..devices.len() {
            if devices[i].index == device_index {
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
}
