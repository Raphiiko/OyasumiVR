use std::ptr::null_mut;
use std::sync::Arc;

use log::error;
use serde::Serialize;
use tokio::runtime::Handle;
use tokio::sync::mpsc::{channel, Receiver, Sender};
use tokio::sync::Mutex;
use widestring::U16Str;
use windows::core::{ComInterface, PCWSTR, PWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
    IAudioMeterInformation,
};
use windows::Win32::Media::Audio::{
    eCapture, eRender, EDataFlow, IMMDevice, IMMEndpoint, AUDIO_VOLUME_NOTIFICATION_DATA,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToBSTR;
use windows::Win32::System::Com::{CLSCTX_ALL, STGM_READ};

use super::wrappers::{
    AudioDeviceIAudioEndpointVolume, AudioDeviceIAudioEndpointVolumeCallback,
    AudioDeviceIAudioMeterInformation, AudioDeviceIMMDevice,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceDto {
    pub id: String,
    pub name: String,
    pub device_type: AudioDeviceType,
    pub volume: f32,
    pub mute: bool,
    pub default: bool,
    pub default_communications: bool,
}

impl AudioDeviceDto {
    pub async fn from(value: &AudioDevice) -> Self {
        AudioDeviceDto::from_state(&value.state).await
    }

    pub async fn from_state(value: &AudioDeviceState) -> Self {
        Self {
            id: value.id.clone(),
            name: value.name.clone(),
            device_type: value.device_type,
            volume: value.volume.lock().await.clone(),
            mute: value.mute.lock().await.clone(),
            default: value.default.lock().await.clone(),
            default_communications: value.default_communications.lock().await.clone(),
        }
    }
}

pub struct AudioDeviceState {
    id: String,
    name: String,
    device_type: AudioDeviceType,
    volume: Mutex<f32>,
    mute: Mutex<bool>,
    default: Mutex<bool>,
    default_communications: Mutex<bool>,
    mmdevice: Mutex<AudioDeviceIMMDevice>,
    endpoint_volume: Mutex<AudioDeviceIAudioEndpointVolume>,
    meter_information: Mutex<AudioDeviceIAudioMeterInformation>,
    metering_enabled: Mutex<bool>,
    notification_client: Mutex<AudioDeviceIAudioEndpointVolumeCallback>,
}

impl AudioDeviceState {
    pub async fn notify_device_changed(&self) {
        let device = AudioDeviceDto::from_state(self).await;
        crate::utils::send_event("audioDeviceUpdated", &device).await;
    }
}

#[derive(PartialEq, Eq, Clone, Copy, Serialize)]
pub enum AudioDeviceType {
    Capture,
    Render,
}

impl From<EDataFlow> for AudioDeviceType {
    fn from(value: EDataFlow) -> Self {
        match value {
            eCapture => AudioDeviceType::Capture,
            eRender => AudioDeviceType::Render,
            _ => panic!("Unknown audio device type"),
        }
    }
}

impl Into<EDataFlow> for AudioDeviceType {
    fn into(self) -> EDataFlow {
        match self {
            AudioDeviceType::Capture => eCapture,
            AudioDeviceType::Render => eRender,
        }
    }
}

pub struct AudioDevice {
    state: Arc<AudioDeviceState>,
}

impl AudioDevice {
    pub fn new(mmdevice: IMMDevice) -> windows::core::Result<Self> {
        unsafe {
            // Get basic device info
            let id = AudioDevice::get_id_from_mmdevice(&mmdevice)?;
            let properties = mmdevice.OpenPropertyStore(STGM_READ)?;
            let name = properties.GetValue(&PKEY_Device_FriendlyName)?;
            let name = U16Str::from_slice(PropVariantToBSTR(&name)?.as_wide()).to_string_lossy();
            // Reference endpoint volume and listen for volume notifications
            let endpoint_volume = mmdevice.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)?;
            let (on_notify_tx, on_notify_rx) = channel::<()>(10);
            let notification_client = AudioDeviceVolumeNotificationClient::new(on_notify_tx);
            endpoint_volume.RegisterControlChangeNotify(&notification_client)?;
            // Get endpoint specific info
            let endpoint = mmdevice
                .cast::<IMMEndpoint>()
                .expect("Could not get IMMEndpoint from IMMDevice");
            let flow = endpoint.GetDataFlow()?;
            // Reference meter information
            let meter_information =
                mmdevice.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None)?;
            // Construct the device
            let device = Self {
                state: Arc::new(AudioDeviceState {
                    id,
                    name,
                    device_type: flow.into(),
                    volume: Mutex::new(0.0),
                    mute: Mutex::new(false),
                    default: Mutex::new(false),
                    default_communications: Mutex::new(false),
                    mmdevice: Mutex::new(AudioDeviceIMMDevice(mmdevice)),
                    endpoint_volume: Mutex::new(AudioDeviceIAudioEndpointVolume(endpoint_volume)),
                    meter_information: Mutex::new(AudioDeviceIAudioMeterInformation(
                        meter_information,
                    )),
                    metering_enabled: Mutex::new(false),
                    notification_client: Mutex::new(AudioDeviceIAudioEndpointVolumeCallback(
                        notification_client,
                    )),
                }),
            };
            // Start listening for notifications
            device.process_notifications(on_notify_rx);
            Ok(device)
        }
    }

    fn process_notifications(&self, mut rx: Receiver<()>) {
        let state = self.state.clone();
        tokio::task::spawn(async move {
            while let Some(_) = rx.recv().await {
                _ = AudioDevice::fetch_state(state.clone()).await
            }
        });
    }

    pub fn get_id(&self) -> String {
        self.state.id.clone()
    }

    pub async fn set_default(&self, default: bool) {
        *self.state.default.lock().await = default;
    }

    pub async fn is_default(&self) -> bool {
        *self.state.default.lock().await
    }

    pub async fn set_default_communications(&self, default_communications: bool) {
        *self.state.default_communications.lock().await = default_communications;
    }

    pub async fn is_default_communications(&self) -> bool {
        *self.state.default_communications.lock().await
    }

    pub fn get_name(&self) -> String {
        self.state.name.clone()
    }

    pub fn get_device_type(&self) -> AudioDeviceType {
        self.state.device_type
    }

    pub async fn get_volume(&self) -> f32 {
        self.state.volume.lock().await.clone()
    }

    pub async fn get_mute(&self) -> bool {
        self.state.mute.lock().await.clone()
    }

    pub async fn update_state(&self) -> windows::core::Result<()> {
        AudioDevice::fetch_state(self.state.clone()).await
    }

    pub async fn fetch_state(state: Arc<AudioDeviceState>) -> windows::core::Result<()> {
        _ = AudioDevice::fetch_mute(state.clone(), false).await;
        _ = AudioDevice::fetch_volume(state.clone(), false).await;
        _ = state.notify_device_changed().await;
        Ok(())
    }

    pub async fn set_volume(&self, value: f32) -> windows::core::Result<()> {
        unsafe {
            let result = self
                .state
                .endpoint_volume
                .lock()
                .await
                .0
                .SetMasterVolumeLevelScalar(value, null_mut());
            *self.state.volume.lock().await = value;
            _ = self.state.notify_device_changed().await;
            result
        }
    }

    pub async fn set_mute(&self, mute: bool) -> windows::core::Result<()> {
        unsafe {
            let result = self
                .state
                .endpoint_volume
                .lock()
                .await
                .0
                .SetMute(mute, null_mut());
            *self.state.mute.lock().await = mute;
            _ = self.state.notify_device_changed().await;
            result
        }
    }

    async fn fetch_volume(
        state: Arc<AudioDeviceState>,
        notify: bool,
    ) -> windows::core::Result<f32> {
        let endpoint_volume = state.endpoint_volume.lock().await;
        unsafe {
            let volume = endpoint_volume.0.GetMasterVolumeLevelScalar()?;
            *state.volume.lock().await = volume;
            if notify {
                _ = state.notify_device_changed().await;
            }
            Ok(volume)
        }
    }

    async fn fetch_mute(state: Arc<AudioDeviceState>, notify: bool) -> windows::core::Result<bool> {
        unsafe {
            let endpoint_volume = state.endpoint_volume.lock().await;
            let value: bool = match endpoint_volume.0.GetMute() {
                Ok(mute) => mute.clone().into(),
                Err(e) => return Err(e),
            };
            *state.mute.lock().await = value;
            if notify {
                _ = state.notify_device_changed().await;
            }
            Ok(value)
        }
    }

    pub async fn enable_metering(&self) {
        let state = self.state.clone();
        let mut metering_enabled = state.metering_enabled.lock().await;
        if *metering_enabled {
            return;
        }
        *metering_enabled = true;
        drop(metering_enabled);
        tokio::spawn(async move {
            loop {
                // Stop if metering has been disabled
                let metering_enabled = state.metering_enabled.lock().await;
                if !*metering_enabled {
                    break;
                }
                drop(metering_enabled);
                // Get the meter value
                let meter = state.meter_information.lock().await;
                let value = match unsafe { meter.0.GetPeakValue() } {
                    Ok(value) => value,
                    Err(e) => {
                        continue;
                    }
                };
                drop(meter);
                // TODO: Do something with the meter value
                tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
            }
        });
    }

    pub async fn disable_metering(state: Arc<AudioDeviceState>) {
        let mut metering_enabled = state.metering_enabled.lock().await;
        if !*metering_enabled {
            return;
        }
        *metering_enabled = false;
    }

    pub fn get_id_from_mmdevice(device: &IMMDevice) -> windows::core::Result<String> {
        unsafe { AudioDevice::get_id_from_pwstr(&device.GetId()?) }
    }

    pub fn get_id_from_pcwstr(device_id: &PCWSTR) -> windows::core::Result<String> {
        unsafe { Ok(U16Str::from_slice(device_id.as_wide()).to_string_lossy()) }
    }

    pub fn get_id_from_pwstr(device_id: &PWSTR) -> windows::core::Result<String> {
        unsafe { Ok(U16Str::from_slice(device_id.as_wide()).to_string_lossy()) }
    }
}

impl Drop for AudioDevice {
    fn drop(&mut self) {
        let state = self.state.clone();
        tokio::spawn(async move {
            // Disable metering if needed
            {
                AudioDevice::disable_metering(state.clone()).await;
            }
            // Unregister notification client
            {
                let endpoint_volume = state.endpoint_volume.lock().await;
                let notification_client = state.notification_client.lock().await;
                let _ = unsafe {
                    endpoint_volume
                        .0
                        .UnregisterControlChangeNotify(&notification_client.0)
                };
            }
        });
    }
}

#[windows::core::implement(IAudioEndpointVolumeCallback)]
struct AudioDeviceVolumeNotificationClient {
    handle: Handle,
    channel: Sender<()>,
}

impl AudioDeviceVolumeNotificationClient {
    fn new(channel: Sender<()>) -> IAudioEndpointVolumeCallback {
        let val = Self {
            handle: Handle::current(),
            channel,
        };
        val.into()
    }
}

impl IAudioEndpointVolumeCallback_Impl for AudioDeviceVolumeNotificationClient {
    #[allow(non_snake_case)]
    fn OnNotify(&self, _notify: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        let tx = self.channel.clone();
        self.handle.spawn(async move {
            if let Err(e) = tx.send(()).await {
                error!(
                    "[Core] onNotify could not send channel notification: {:?}",
                    e
                );
            }
        });
        Ok(())
    }
}
