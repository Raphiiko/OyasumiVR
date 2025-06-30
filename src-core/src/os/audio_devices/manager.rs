use super::device::{AudioDevice, AudioDeviceDto, AudioDeviceType};
use super::wrappers::{
    AudioDeviceManagerIMMDeviceEnumerator, AudioDeviceManagerIMMNotificationClient,
    AudioDevicePCWSTR,
};
use async_recursion::async_recursion;
use futures_util::future::join_all;
use log::error;
use std::sync::Arc;
use tokio::runtime::Handle;
use tokio::sync::mpsc::{channel, Receiver, Sender};
use tokio::sync::Mutex;
use windows::core::PCWSTR;
use windows::Win32::Media::Audio::{
    eAll, eCapture, eCommunications, eMultimedia, eRender, EDataFlow, ERole, IMMDeviceEnumerator,
    IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, DEVICE_STATE, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

#[derive(Debug)]
enum DeviceNotification {
    Added {
        device_id: AudioDevicePCWSTR,
    },
    Removed {
        device_id: AudioDevicePCWSTR,
    },
    StateChanged {
        device_id: AudioDevicePCWSTR,
        state: u32,
    },
    DefaultDeviceChanged {
        device_id: AudioDevicePCWSTR,
        flow: EDataFlow,
    },
    PropertyValueChanged {
        device_id: AudioDevicePCWSTR,
    },
}

pub struct AudioDeviceManagerState {
    devices: Mutex<Vec<AudioDevice>>,
    enumerator: Mutex<AudioDeviceManagerIMMDeviceEnumerator>,
    mic_activity_device_id: Mutex<Option<String>>,
    mic_activity_enabled: Mutex<bool>,
    mic_activation_threshold: Mutex<f32>,
    _notification_client: Mutex<AudioDeviceManagerIMMNotificationClient>,
}

impl AudioDeviceManagerState {
    pub async fn notify_devices_changed(&self) {
        let devices = self.get_devices().await;
        crate::utils::send_event("audioDevicesUpdated", &devices).await;
    }

    pub async fn get_devices(&self) -> Vec<AudioDeviceDto> {
        let devices = self.devices.lock().await;
        let futures: Vec<_> = devices.iter().map(AudioDeviceDto::from).collect();
        join_all(futures).await
    }

    pub async fn evaluate_capture_device_metering(&self) {
        let mic_activity_enabled = *self.mic_activity_enabled.lock().await;
        let device_id = match self.mic_activity_device_id.lock().await.as_ref() {
            Some(device_id) => device_id.clone(),
            None => String::from(""),
        };
        let devices = self.devices.lock().await;
        for device in devices.iter() {
            if !mic_activity_enabled {
                device.disable_metering().await;
            } else if device_id == *"DEFAULT" {
                if device.get_device_type() == AudioDeviceType::Capture {
                    if device.is_default().await {
                        device.enable_metering().await;
                    } else {
                        device.disable_metering().await;
                    }
                }
            } else if device.get_id() == device_id {
                device.enable_metering().await;
            } else {
                device.disable_metering().await;
            }
        }
    }
}

pub struct AudioDeviceManager {
    state: Arc<AudioDeviceManagerState>,
}

impl AudioDeviceManager {
    pub async fn create() -> windows::core::Result<Self> {
        unsafe {
            // Initialize com library
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED).ok();
            // // Initialize MMDeviceEnumerator
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            // Setup refresh channel for notification callbacks
            let (refresh_tx, refresh_rx) = channel::<DeviceNotification>(10);
            let notification_client = AudioDeviceManagerNotificationClient::new(refresh_tx)?;
            let notification_client: IMMNotificationClient = notification_client.into();
            enumerator.RegisterEndpointNotificationCallback(&notification_client)?;
            // Construct AudioDeviceManager
            let manager = Self {
                state: Arc::new(AudioDeviceManagerState {
                    enumerator: Mutex::new(AudioDeviceManagerIMMDeviceEnumerator(enumerator)),
                    devices: Mutex::default(),
                    mic_activity_enabled: Mutex::new(false),
                    mic_activation_threshold: Mutex::new(0.04),
                    mic_activity_device_id: Mutex::default(),
                    _notification_client: Mutex::new(AudioDeviceManagerIMMNotificationClient(
                        notification_client,
                    )),
                }),
            };
            manager.process_events(refresh_rx);
            Ok(manager)
        }
    }

    pub async fn get_devices(&self) -> Vec<AudioDeviceDto> {
        self.state.get_devices().await
    }

    pub async fn set_mic_activity_device_id(&self, device_id: Option<String>) {
        *self.state.mic_activity_device_id.lock().await = device_id.clone();
        self.state.evaluate_capture_device_metering().await;
    }

    pub async fn get_mic_activation_threshold(&self) -> f32 {
        *self.state.mic_activation_threshold.lock().await
    }

    pub async fn set_mic_activation_threshold(&self, value: f32) {
        *self.state.mic_activation_threshold.lock().await = value;
    }

    pub async fn set_mic_activity_enabled(&self, enabled: bool) {
        *self.state.mic_activity_enabled.lock().await = enabled;
        self.state.evaluate_capture_device_metering().await;
    }

    #[async_recursion]
    async fn process_event(state: Arc<AudioDeviceManagerState>, notification: DeviceNotification) {
        match notification {
            DeviceNotification::Added { device_id } => {
                // We'll just refresh all devices in this case
                if let Err(e) = AudioDeviceManager::_refresh_audio_devices(state.clone()).await {
                    error!("[Core] Could not refresh audio devices: {:?}", e);
                }
                state.notify_devices_changed().await;
                state.evaluate_capture_device_metering().await;
            }
            DeviceNotification::Removed { device_id } => {
                let device_id = match AudioDevice::get_id_from_pcwstr(&device_id.0) {
                    Ok(device_id) => device_id,
                    Err(err) => {
                        error!(
                        "[Core] Could not determine removed audio device (removed, could not determine id): {:?}",
                        err
                    );
                        return;
                    }
                };
                let mut devices = state.devices.lock().await;
                let index = devices
                    .iter()
                    .position(|device| device.get_id() == device_id);
                if let Some(index) = index {
                    devices.remove(index);
                }
                drop(devices);
                // Redetermine default devices
                AudioDeviceManager::determine_all_default_devices(&state).await;
                state.evaluate_capture_device_metering().await;
            }
            DeviceNotification::StateChanged {
                device_id: pcw_device_id,
                state: device_state,
            } => {
                let device_id = match AudioDevice::get_id_from_pcwstr(&pcw_device_id.0) {
                    Ok(device_id) => device_id,
                    Err(err) => {
                        error!(
                    "[Core] Could not determine audio device (state changed, could not determine id): {:?}",
                    err
                );
                        return;
                    }
                };
                let known_device = state
                    .devices
                    .lock()
                    .await
                    .iter()
                    .any(|device| device.get_id() == device_id);
                let is_active = device_state == DEVICE_STATE_ACTIVE.0;
                // If the device is active, we might need to add it.
                if is_active && !known_device {
                    AudioDeviceManager::process_event(
                        state,
                        DeviceNotification::Added {
                            device_id: pcw_device_id,
                        },
                    )
                    .await;
                }
                // Otherwise, we might need to remove it.
                else if !is_active && known_device {
                    AudioDeviceManager::process_event(
                        state,
                        DeviceNotification::Removed {
                            device_id: pcw_device_id,
                        },
                    )
                    .await;
                }
            }
            DeviceNotification::DefaultDeviceChanged { device_id: _, flow } => {
                if flow == eAll || flow == eRender {
                    let state = state.as_ref();
                    if let Err(e) = AudioDeviceManager::determine_default_devices(
                        state,
                        AudioDeviceType::Render,
                        false,
                    )
                    .await
                    {
                        error!("[Core] Could not determine default render devices: {:?}", e);
                    }
                }
                if flow == eAll || flow == eCapture {
                    let state = state.as_ref();
                    if let Err(e) = AudioDeviceManager::determine_default_devices(
                        state,
                        AudioDeviceType::Capture,
                        false,
                    )
                    .await
                    {
                        error!(
                            "[Core] Could not determine default capture devices: {:?}",
                            e
                        );
                    }
                }
                state.notify_devices_changed().await;
                state.evaluate_capture_device_metering().await;
            }
            DeviceNotification::PropertyValueChanged { device_id } => {
                let device_id = match AudioDevice::get_id_from_pcwstr(&device_id.0) {
                    Ok(device_id) => device_id,
                    Err(err) => {
                        error!(
                        "[Core] Could not determine audio device (property value changed, could not determine id): {:?}",
                        err
                    );
                        return;
                    }
                };
                let devices = state.devices.lock().await;
                let index = devices
                    .iter()
                    .position(|device| device.get_id() == device_id);
                match index {
                    Some(index) => {
                        if let Err(e) = devices[index].update_state().await {
                            error!("[Core] Could not fetch state: {:?}", e);
                        }
                    }
                    None => {
                        // We ignore this, as we can get this notification for devices that are not in our list
                    }
                }
                drop(devices);
            }
        }
    }

    fn process_events(&self, mut rx: Receiver<DeviceNotification>) {
        let state = self.state.clone();
        tokio::task::spawn(async move {
            while let Some(notification) = rx.recv().await {
                AudioDeviceManager::process_event(state.clone(), notification).await;
            }
        });
    }

    async fn determine_all_default_devices(state: &AudioDeviceManagerState) {
        if let Err(e) =
            AudioDeviceManager::determine_default_devices(state, AudioDeviceType::Capture, false)
                .await
        {
            error!(
                "[Core] Could not determine default capture devices: {:?}",
                e
            );
        }
        if let Err(e) =
            AudioDeviceManager::determine_default_devices(state, AudioDeviceType::Render, false)
                .await
        {
            error!("[Core] Could not determine default render devices: {:?}", e);
        }
        // Notify observers
        state.notify_devices_changed().await;
    }

    async fn determine_default_devices(
        state: &AudioDeviceManagerState,
        device_type: AudioDeviceType,
        notify: bool,
    ) -> windows::core::Result<()> {
        let enumerator = state.enumerator.lock().await;
        let devices = state.devices.lock().await;
        let devices: Vec<&AudioDevice> = devices
            .iter()
            .filter(|device| device.get_device_type() == device_type)
            .collect();
        unsafe {
            let default_device = enumerator
                .0
                .GetDefaultAudioEndpoint(device_type.into(), eMultimedia)
                .ok()
                .and_then(|d| AudioDevice::get_id_from_mmdevice(&d).ok());
            let default_communications_device = enumerator
                .0
                .GetDefaultAudioEndpoint(device_type.into(), eCommunications)
                .ok()
                .and_then(|d| AudioDevice::get_id_from_mmdevice(&d).ok());
            drop(enumerator);
            if let Some(device_id) = default_device {
                for device in devices.iter() {
                    device.set_default(device_id == device.get_id()).await;
                }
            }
            if let Some(device_id) = default_communications_device {
                for device in devices.iter() {
                    device
                        .set_default_communications(device_id == device.get_id())
                        .await;
                }
            }
        };
        if notify {
            state.notify_devices_changed().await;
        }
        Ok(())
    }

    pub async fn refresh_audio_devices(&self) -> windows::core::Result<()> {
        AudioDeviceManager::_refresh_audio_devices(self.state.clone()).await
    }

    async fn _refresh_audio_devices(
        state: Arc<AudioDeviceManagerState>,
    ) -> windows::core::Result<()> {
        let data_flow = eAll;
        let state_mask = DEVICE_STATE_ACTIVE;
        let enumerator = state.enumerator.lock().await;
        let new_devices = unsafe {
            let collection = enumerator.0.EnumAudioEndpoints(data_flow, state_mask)?;
            drop(enumerator);
            let count = collection.GetCount()?;
            let mut devices: Vec<AudioDevice> = vec![];
            for i in 0..count {
                let item = collection.Item(i);
                match item {
                    Ok(device) => {
                        let device = AudioDevice::new(device);
                        match device {
                            Ok(device) => devices.push(device),
                            Err(err) => error!("Could not get audio endpoint: {:?}", err),
                        }
                    }
                    Err(err) => error!("Could not get audio endpoint: {:?}", err),
                }
            }
            devices
        };
        let mut devices = state.devices.lock().await;
        devices.clear();
        devices.extend(new_devices);
        for device in devices.iter() {
            device.update_state().await.ok();
        }
        drop(devices);
        AudioDeviceManager::determine_all_default_devices(&state).await;
        Ok(())
    }

    pub async fn set_volume(&self, device_id: String, volume: f32) {
        let locked_devices = self.state.devices.lock().await;
        if let Some(device) = locked_devices
            .iter()
            .find(|device| device.get_id() == device_id)
        {
            if let Err(e) = device.set_volume(volume).await {
                error!(
                    "[Core] Could not set volume for audio device ({}): {:?}",
                    device_id, e
                );
            }
        } else {
            error!(
                "[Core] Attempted setting volume for unknown device: {}",
                device_id
            );
        }
    }

    pub async fn set_mute(&self, device_id: String, mute: bool) {
        let locked_devices = self.state.devices.lock().await;
        if let Some(device) = locked_devices
            .iter()
            .find(|device| device.get_id() == device_id)
        {
            if let Err(e) = device.set_mute(mute).await {
                error!(
                    "[Core] Could not set mute state for audio device ({}): {:?}",
                    device_id, e
                );
            }
        } else {
            error!(
                "[Core] Attempted setting mute state for unknown device: {}",
                device_id
            );
        }
    }
}

#[windows::core::implement(IMMNotificationClient)]
struct AudioDeviceManagerNotificationClient {
    refresh_tx: Sender<DeviceNotification>,
    handle: Handle,
}

impl AudioDeviceManagerNotificationClient {
    fn new(refresh_tx: Sender<DeviceNotification>) -> windows::core::Result<Self> {
        Ok(Self {
            refresh_tx,
            handle: Handle::current(),
        })
    }
}

impl IMMNotificationClient_Impl for AudioDeviceManagerNotificationClient {
    #[allow(non_snake_case)]
    fn OnDeviceStateChanged(
        &self,
        pwstrdeviceid: &PCWSTR,
        dwnewstate: DEVICE_STATE,
    ) -> windows::core::Result<()> {
        let device_id = AudioDevicePCWSTR(*pwstrdeviceid);
        let tx = self.refresh_tx.clone();
        self.handle.spawn(async move {
            if let Err(e) = tx
                .send(DeviceNotification::StateChanged {
                    device_id,
                    state: dwnewstate.0,
                })
                .await
            {
                error!(
                    "[Core] OnDeviceStateChanged could not send channel notification: {:?}",
                    e
                );
            }
        });
        Ok(())
    }

    #[allow(non_snake_case)]
    fn OnDeviceAdded(&self, pwstrdeviceid: &PCWSTR) -> windows::core::Result<()> {
        let device_id = AudioDevicePCWSTR(*pwstrdeviceid);
        let tx = self.refresh_tx.clone();
        self.handle.spawn(async move {
            if let Err(e) = tx.send(DeviceNotification::Added { device_id }).await {
                error!(
                    "[Core] OnDeviceAdded could not send channel notification: {:?}",
                    e
                );
            }
        });
        Ok(())
    }

    #[allow(non_snake_case)]
    fn OnDeviceRemoved(&self, pwstrdeviceid: &PCWSTR) -> windows::core::Result<()> {
        let device_id = AudioDevicePCWSTR(*pwstrdeviceid);
        let tx = self.refresh_tx.clone();
        self.handle.spawn(async move {
            if let Err(e) = tx.send(DeviceNotification::Removed { device_id }).await {
                error!(
                    "[Core] OnDeviceRemoved could not send channel notification: {:?}",
                    e
                );
            }
        });
        Ok(())
    }

    #[allow(non_snake_case)]
    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        _role: ERole,
        pwstrdeviceid: &PCWSTR,
    ) -> windows::core::Result<()> {
        let device_id = AudioDevicePCWSTR(*pwstrdeviceid);
        let tx = self.refresh_tx.clone();
        self.handle.spawn(async move {
            if let Err(e) = tx
                .send(DeviceNotification::DefaultDeviceChanged { device_id, flow })
                .await
            {
                error!(
                    "[Core] OnDefaultDeviceChanged could not send channel notification: {:?}",
                    e
                );
            }
        });
        Ok(())
    }

    #[allow(non_snake_case)]
    fn OnPropertyValueChanged(
        &self,
        pwstrdeviceid: &PCWSTR,
        _key: &windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY,
    ) -> windows::core::Result<()> {
        let device_id = AudioDevicePCWSTR(*pwstrdeviceid);
        let tx = self.refresh_tx.clone();
        self.handle.spawn(async move {
            if let Err(e) = tx
                .send(DeviceNotification::PropertyValueChanged { device_id })
                .await
            {
                error!(
                    "[Core] OnPropertyValueChanged could not send channel notification: {:?}",
                    e
                );
            }
        });
        Ok(())
    }
}
