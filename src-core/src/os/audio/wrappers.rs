use windows::core::PCWSTR;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolumeCallback, IAudioMeterInformation,
};
use windows::Win32::Media::Audio::{
    Endpoints::IAudioEndpointVolume, IMMDevice, IMMDeviceEnumerator, IMMNotificationClient,
};

#[derive(Debug)]
pub struct AudioDeviceIMMDevice(pub IMMDevice);

unsafe impl Send for AudioDeviceIMMDevice {}

#[derive(Debug)]
pub struct AudioDeviceIAudioEndpointVolume(pub IAudioEndpointVolume);

unsafe impl Send for AudioDeviceIAudioEndpointVolume {}

#[derive(Debug)]
pub struct AudioDeviceIAudioMeterInformation(pub IAudioMeterInformation);

unsafe impl Send for AudioDeviceIAudioMeterInformation {}

#[derive(Debug)]
pub struct AudioDeviceManagerIMMDeviceEnumerator(pub IMMDeviceEnumerator);

unsafe impl Send for AudioDeviceManagerIMMDeviceEnumerator {}

#[derive(Debug)]
pub struct AudioDeviceManagerIMMNotificationClient(pub IMMNotificationClient);

unsafe impl Send for AudioDeviceManagerIMMNotificationClient {}

#[derive(Debug)]
pub struct AudioDevicePCWSTR(pub PCWSTR);

unsafe impl Send for AudioDevicePCWSTR {}

#[derive(Debug)]
pub struct AudioDeviceIAudioEndpointVolumeCallback(pub IAudioEndpointVolumeCallback);

unsafe impl Send for AudioDeviceIAudioEndpointVolumeCallback {}
