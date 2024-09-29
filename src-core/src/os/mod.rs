mod audio_devices;
pub mod commands;
mod models;
mod sounds_gen;

use self::audio_devices::manager::AudioDeviceManager;
use lazy_static::lazy_static;
use log::{error, info};
use rodio::{source::Source, Decoder};
use rodio::{OutputStream, Sink};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::File;
use std::io::BufReader;
use std::os::windows::ffi::OsStringExt;
use std::ptr::null_mut;
use std::slice;
use std::time::Duration;
use tokio::sync::mpsc::Sender;
use tokio::sync::Mutex;
use winapi::shared::guiddef::GUID;
use winapi::shared::minwindef::{DWORD, UCHAR, ULONG};
use winapi::um::powersetting::{PowerGetActiveScheme, PowerSetActiveScheme};
use winapi::um::powrprof::{PowerEnumerate, PowerReadFriendlyName};

lazy_static! {
    static ref PLAY_SOUND_TX: Mutex<Option<Sender<(String, f32)>>> = Mutex::default();
    static ref AUDIO_DEVICE_MANAGER: Mutex<Option<AudioDeviceManager>> = Mutex::default();
    static ref VRCHAT_ACTIVE: Mutex<bool> = Mutex::new(false);
    static ref MEMORY_WATCHER_ACTIVE: Mutex<bool> = Mutex::new(false);
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
    tokio::task::spawn(watch_processes());
}

async fn watch_processes() {
    loop {
        {
            let res = crate::utils::is_process_active("VRChat.exe", false).await;
            let mut vrc_active = VRCHAT_ACTIVE.lock().await;
            if *vrc_active != res {
                *vrc_active = res;
                crate::utils::send_event("VRCHAT_PROCESS_ACTIVE", res).await;
                if res {
                    info!("[Core] Detected VRChat process has started");
                } else {
                    info!("[Core] Detected VRChat process has stopped");
                }
            }
        }
        if {
            let watcher_active = MEMORY_WATCHER_ACTIVE.lock().await;
            *watcher_active
        } {
            crate::utils::monitor_memory_usage(false).await;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

pub async fn init_sound_playback() {
    // Create channel
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(String, f32)>(32);
    *PLAY_SOUND_TX.lock().await = Some(tx);

    // Spawn task to play sounds
    tokio::task::spawn(async move {
        // Load sound files
        let mut sounds = HashMap::new();
        sounds_gen::SOUND_FILES.iter().for_each(|sound| {
            let path = format!("resources/sounds/{}.ogg", sound);
            let file = match File::open(path.clone()) {
                Ok(f) => f,
                Err(e) => {
                    error!("[Core] Failed to open sound file: {}", e);
                    return;
                }
            };
            let reader = BufReader::new(file);
            let source = match Decoder::new(reader) {
                Ok(s) => s.buffered(),
                Err(e) => {
                    error!(
                        "[Core] Failed to decode sound file at path ({}): {}",
                        path.clone(),
                        e
                    );
                    return;
                }
            };
            sounds.insert(String::from(*sound), source);
        });
        // Play sounds when requested
        while let Some((sound, volume)) = rx.recv().await {
            if let Some(source) = sounds.get(&sound) {
                // Initialize output stream
                let (_stream, stream_handle) = match OutputStream::try_default() {
                    Ok((stream, handle)) => (stream, handle),
                    Err(e) => {
                        error!("[Core] Failed to initialize audio output stream: {}", e);
                        return;
                    }
                };
                // Play sound
                let source = source.clone();
                let sink = match Sink::try_new(&stream_handle) {
                    Ok(s) => s,
                    Err(e) => {
                        error!("[Core] Failed to create audio sink: {}", e);
                        return;
                    }
                };
                sink.set_volume(volume);
                sink.append(source.clone());
                // sink.detach();
                sink.sleep_until_end();
            } else {
                error!("[Core] Sound not found: {}", sound);
            }
        }
    });
}

fn get_windows_power_policies() -> Vec<GUID> {
    let mut power_schemes = Vec::new();
    let mut index: ULONG = 0;
    let mut buffer_size: DWORD = std::mem::size_of::<GUID>() as DWORD;

    loop {
        let mut buffer: GUID = unsafe { std::mem::zeroed() };
        let result = unsafe {
            PowerEnumerate(
                null_mut(),
                null_mut(),
                null_mut(),
                winapi::um::powrprof::ACCESS_SCHEME,
                index,
                &mut buffer as *mut _ as *mut UCHAR,
                &mut buffer_size as *mut _ as *mut DWORD,
            )
        };

        if result == winapi::shared::winerror::ERROR_SUCCESS {
            power_schemes.push(buffer);
            index += 1;
        } else {
            break;
        }
    }

    power_schemes
}

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

fn get_friendly_name_for_windows_power_policy(scheme_guid: &GUID) -> Option<String> {
    let mut buffer_size: DWORD = 0;

    // First call to determine the buffer size needed
    let result = unsafe {
        PowerReadFriendlyName(
            null_mut(),
            scheme_guid as *const _,
            null_mut(),
            null_mut(),
            null_mut() as *mut UCHAR,
            &mut buffer_size,
        )
    };

    if result != winapi::shared::winerror::ERROR_SUCCESS || buffer_size == 0 {
        return None;
    }

    let mut buffer: Vec<UCHAR> = Vec::with_capacity(buffer_size as usize);
    buffer.resize(buffer_size as usize, 0);

    // Second call to actually get the friendly name
    let result = unsafe {
        PowerReadFriendlyName(
            null_mut(),
            scheme_guid as *const _,
            null_mut(),
            null_mut(),
            buffer.as_mut_ptr(),
            &mut buffer_size,
        )
    };

    if result != winapi::shared::winerror::ERROR_SUCCESS {
        return None;
    }

    let wide_buffer =
        unsafe { slice::from_raw_parts(buffer.as_ptr() as *const u16, buffer_size as usize / 2) };
    let os_str = OsString::from_wide(wide_buffer);

    match os_str.to_string_lossy().into_owned() {
        s if !s.is_empty() => Some(s.trim_end_matches('\0').to_string()),
        _ => None,
    }
}
