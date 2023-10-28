mod audio_devices;
pub mod commands;
mod models;

use log::error;
use soloud::*;
use std::collections::HashMap;
use tokio::sync::Mutex;
use winapi::shared::guiddef::GUID;
use winapi::um::powersetting::{PowerGetActiveScheme, PowerSetActiveScheme};
use winapi::DEFINE_GUID;

use self::audio_devices::manager::AudioDeviceManager;

lazy_static! {
    static ref SOUNDS: std::sync::Mutex<HashMap<String, Vec<u8>>> =
        std::sync::Mutex::new(HashMap::new());
    static ref SOLOUD: std::sync::Mutex<Soloud> = std::sync::Mutex::new(Soloud::default().unwrap());
    static ref AUDIO_DEVICE_MANAGER: Mutex<Option<AudioDeviceManager>> = Mutex::default();
}

pub async fn init_audio_device_manager() {
    let mut manager = AUDIO_DEVICE_MANAGER.lock().await;
    if manager.is_some() {
        return;
    }
    let m = match AudioDeviceManager::create().await {
        Ok(m) => m,
        Err(e) => {
            error!("[Core] Failed to create audio device manager: {}", e);
            return;
        }
    };
    *manager = Some(m);
    if let Err(e) = manager.as_ref().unwrap().refresh_audio_devices().await {
        error!("[Core] Failed to refresh audio devices: {}", e);
    }
}

pub async fn load_sounds() {
    let mut sounds = SOUNDS.lock().unwrap();
    vec![
        "notification_bell",
        "notification_block",
        "notification_reverie",
        "mic_mute",
        "mic_unmute",
    ]
    .iter()
    .for_each(|sound| {
        sounds.insert(
            String::from(*sound),
            std::fs::read(format!("resources/sounds/{}.ogg", sound)).expect(
                format!(
                    "Could not find sound file at path: {}",
                    format!("resources/sounds/{}.ogg", sound).as_str()
                )
                .as_str(),
            ),
        );
    });
}

DEFINE_GUID! {GUID_POWER_POLICY_POWER_SAVING,
0xa1841308, 0x3541, 0x4fab, 0xbc, 0x81, 0xf7, 0x15, 0x56, 0xf2, 0x0b, 0x4a}
DEFINE_GUID! {GUID_POWER_POLICY_BALANCED,
0x381b4222, 0xf694, 0x41f0, 0x96, 0x85, 0xff, 0x5b, 0xb2, 0x60, 0xdf, 0x2e}
DEFINE_GUID! {GUID_POWER_POLICY_HIGH_PERFORMANCE,
0x8c5e7fda, 0xe8bf, 0x4a96, 0x9a, 0x85, 0xa6, 0xe2, 0x3a, 0x8c, 0x63, 0x5c}

fn active_windows_power_policy() -> Option<GUID> {
    unsafe {
        let mut guid: *mut GUID = std::ptr::null_mut();
        if PowerGetActiveScheme(std::ptr::null_mut(), &mut guid) == 0 && !guid.is_null() {
            Some(*guid)
        } else {
            None
        }
    }
}

fn set_windows_power_policy(guid: &GUID) -> bool {
    let result = unsafe { PowerSetActiveScheme(std::ptr::null_mut(), guid) };
    if result != 0 {
        error!(
            "[Core] Failed to set Windows power policy. Result code {:?}",
            result
        );
    };
    result == 0
}

fn guid_equal(a: &GUID, b: &GUID) -> bool {
    (a.Data1 == b.Data1) && (a.Data2 == b.Data2) && (a.Data3 == b.Data3) && (a.Data4 == b.Data4)
}
