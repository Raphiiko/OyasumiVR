// mod brightness_overlay;
pub mod commands;
mod gesture_detector;
mod models;
mod sleep_detector;

use self::models::{DeviceUpdateEvent, OVRDevice, OVRDevicePose, TrackedDeviceClass};
use crate::utils::send_event;
use byteorder::{ByteOrder, LE};
use chrono::{naive::NaiveDateTime, Utc};
use gesture_detector::GestureDetector;
use log::info;
use models::OpenVRStatus;
use ovr_overlay as ovr;
use sleep_detector::SleepDetector;
use std::{ffi::CStr, sync::Arc, time::Duration};
use substring::Substring;
use tokio::sync::Mutex;

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
    gesture_detector: Arc<Mutex<GestureDetector>>,
    sleep_detector: Arc<Mutex<SleepDetector>>,
    ovr_context: Arc<Mutex<Option<ovr::Context>>>,
}

impl OpenVRManager {
    pub fn new() -> OpenVRManager {
        let manager = OpenVRManager {
            active: Arc::new(Mutex::new(false)),
            status: Arc::new(Mutex::new(OpenVRStatus::Inactive)),
            devices: Arc::new(Mutex::new(vec![])),
            gesture_detector: Arc::new(Mutex::new(GestureDetector::new())),
            sleep_detector: Arc::new(Mutex::new(SleepDetector::new())),
            ovr_context: Arc::new(Mutex::new(None)),
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
            .find(|device| device.class == TrackedDeviceClass::HMD);
        if device.is_some() {
            let context_guard = self.ovr_context.lock().await;
            let context = match context_guard.as_ref() {
                Some(context) => context,
                None => return Err("OPENVR_NOT_INITIALISED".to_string()),
            };
            let mut settings = context.settings_mngr();
            let analog_gain = settings.get_float(
                CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_Section).unwrap(),
                CStr::from_bytes_with_nul(b"analogGain\0").unwrap(),
            );
            return match analog_gain {
                Ok(analog_gain) => Ok(analog_gain),
                Err(_) => Err("ANALOG_GAIN_NOT_FOUND".to_string()),
            };
        } else {
            return Err("NO_HMD_FOUND".to_string());
        }
    }

    pub async fn set_analog_gain(&self, analog_gain: f32) -> Result<(), String> {
        let mut devices = self.devices.lock().await;
        let device = devices
            .iter_mut()
            .find(|device| device.class == TrackedDeviceClass::HMD);
        if device.is_some() {
            let context_guard = self.ovr_context.lock().await;
            let context = match context_guard.as_ref() {
                Some(context) => context,
                None => return Err("OPENVR_NOT_INITIALISED".to_string()),
            };
            let settings = &mut context.settings_mngr();
            let _ = settings.set_float(
                CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_Section).unwrap(),
                CStr::from_bytes_with_nul(b"analogGain\0").unwrap(),
                analog_gain,
            );
            Ok(())
        } else {
            Err("NO_HMD_FOUND".to_string())
        }
    }

    pub async fn get_supersample_scale(&self) -> Result<Option<f32>, String> {
        let context_guard = self.ovr_context.lock().await;
        let context = match context_guard.as_ref() {
            Some(context) => context,
            None => return Err("OPENVR_NOT_INITIALISED".to_string()),
        };
        let settings = &mut context.settings_mngr();
        let supersample_manual_override = settings.get_bool(
            CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_Section).unwrap(),
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
        let supersample_scale = settings.get_float(
            CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_Section).unwrap(),
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
        let context_guard = self.ovr_context.lock().await;
        let context = match context_guard.as_ref() {
            Some(context) => context,
            None => return Err("OPENVR_NOT_INITIALISED".to_string()),
        };
        let settings = &mut context.settings_mngr();
        let _ = settings.set_bool(
            CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_Section).unwrap(),
            CStr::from_bytes_with_nul(b"supersampleManualOverride\0").unwrap(),
            supersample_scale.is_some(),
        );
        if supersample_scale.is_some() {
            let _ = settings.set_float(
                CStr::from_bytes_with_nul(ovr::sys::k_pch_SteamVR_Section).unwrap(),
                CStr::from_bytes_with_nul(b"supersampleScale\0").unwrap(),
                supersample_scale.unwrap(),
            );
        }
        Ok(())
    }

    pub async fn get_fade_distance(&self) -> Result<f32, String> {
        let context_guard = self.ovr_context.lock().await;
        let context = match context_guard.as_ref() {
            Some(context) => context,
            None => return Err("OPENVR_NOT_INITIALISED".to_string()),
        };
        let settings = &mut context.settings_mngr();
        let fade_distance = settings.get_float(
            CStr::from_bytes_with_nul(ovr::sys::k_pch_CollisionBounds_Section).unwrap(),
            CStr::from_bytes_with_nul(b"CollisionBoundsFadeDistance\0").unwrap(),
        );
        match fade_distance {
            Ok(fade_distance) => Ok(fade_distance),
            Err(_) => Err("FADE_DISTANCE_NOT_FOUND".to_string()),
        }
    }

    pub async fn set_fade_distance(&self, fade_distance: f32) -> Result<(), String> {
        let context_guard = self.ovr_context.lock().await;
        let context = match context_guard.as_ref() {
            Some(context) => context,
            None => return Err("OPENVR_NOT_INITIALISED".to_string()),
        };
        let settings = &mut context.settings_mngr();
        let _ = settings.set_float(
            CStr::from_bytes_with_nul(ovr::sys::k_pch_CollisionBounds_Section).unwrap(),
            CStr::from_bytes_with_nul(b"CollisionBoundsFadeDistance\0").unwrap(),
            fade_distance,
        );
        Ok(())
    }

    pub async fn init(&mut self) {
        // Task state
        let mut ovr_active = false;
        let mut ovr_next_init = NaiveDateTime::from_timestamp_millis(0).unwrap();
        let mut ovr_next_device_refresh = NaiveDateTime::from_timestamp_millis(0).unwrap();

        // Main Loop
        'ovr_loop: loop {
            tokio::time::sleep(Duration::from_millis(32)).await;
            let state_active = self.active.lock().await;
            let mut ovr_context = self.ovr_context.lock().await;
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
                    let ctx = match ovr::Context::init(
                        ovr::sys::EVRApplicationType::VRApplication_Background,
                    ) {
                        Ok(ctx) => Some(ctx),
                        Err(_) => None,
                    };
                    // If we failed, continue to try again later
                    if ctx.is_none() {
                        *ovr_context = None;
                        continue;
                    }
                    // Set the context on the module state
                    *ovr_context = ctx.clone();
                    // We've successfully initialized OpenVR
                    info!("[Core] OpenVR Initialized");
                    ovr_active = true;
                    self.update_status(OpenVRStatus::Initialized).await;
                }
                //Get system manager
                let system = &mut ovr_context.as_ref().unwrap().system_mngr();
                // Refresh all devices when needed
                if (Utc::now().naive_utc() - ovr_next_device_refresh).num_milliseconds() > 0 {
                    ovr_next_device_refresh = Utc::now().naive_utc() + chrono::Duration::seconds(5);
                    self.update_all_devices(true, system).await;
                }
                // Update poses
                self.refresh_device_poses(system).await;
                // Poll for events
                while let Some(event) = system.poll_next_event() {
                    // Handle Quit event
                    match event.event_type {
                        ovr::sys::EVREventType::VREvent_Quit => {
                            // Shutdown OpenVR
                            info!("[Core] OpenVR is Quitting. Shutting down OpenVR module");
                            ovr_active = false;
                            self.update_status(OpenVRStatus::Inactive).await;
                            unsafe {
                                ovr::sys::VR_Shutdown();
                            }
                            *ovr_context = None;
                            // Schedule next initialization attempt
                            ovr_next_init = Utc::now().naive_utc() + chrono::Duration::seconds(5);
                            continue 'ovr_loop;
                        }
                        ovr::sys::EVREventType::VREvent_TrackedDeviceActivated
                        | ovr::sys::EVREventType::VREvent_TrackedDeviceDeactivated => {
                            self.update_device(event.tracked_device_index, true, system)
                                .await;
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
                                self.update_device(event.tracked_device_index, true, system)
                                    .await;
                            }
                        }
                        _ => {}
                    }
                }
            } else if ovr_active {
                ovr_active = false;
                info!("[Core] Shutting down OpenVR module");
                self.update_status(OpenVRStatus::Inactive).await;
                // Shutdown OpenVR
                let ctx = ovr_context.as_mut();
                if ctx.is_some() {
                    unsafe {
                        ctx.unwrap().shutdown();
                    }
                    *ovr_context = None;
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

    async fn refresh_device_poses<'a>(&self, system: &mut ovr::system::SystemManager<'a>) {
        let poses = system.get_device_to_absolute_tracking_pose(
            ovr::sys::ETrackingUniverseOrigin::TrackingUniverseStanding,
            0.0,
        );
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

    async fn update_all_devices<'a>(
        &self,
        emit: bool,
        system: &mut ovr::system::SystemManager<'a>,
    ) {
        for n in 0..(ovr::sys::k_unMaxTrackedDeviceCount as usize) {
            self.update_device(ovr::TrackedDeviceIndex(n.try_into().unwrap()), emit, system)
                .await;
        }
    }

    async fn update_device<'a>(
        &self,
        device_index: ovr::TrackedDeviceIndex,
        emit: bool,
        system: &mut ovr::system::SystemManager<'a>,
    ) {
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
        let mut devices = self.devices.lock().await;
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
}
