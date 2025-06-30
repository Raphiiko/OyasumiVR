mod audio_devices;
pub mod commands;
mod models;
mod sounds_gen;
pub mod elevation;

use self::audio_devices::manager::AudioDeviceManager;
use std::sync::LazyLock;
use log::{error, info, warn};
use rodio::{source::Source, Decoder};
use rodio::{OutputStream, Sink};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::File;
use std::io::BufReader;
use std::os::windows::ffi::OsStringExt;
use std::slice;
use std::env;
use std::time::Duration;
use tokio::sync::mpsc::Sender;
use tokio::sync::Mutex;
use windows::core::GUID;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Power::{
    PowerEnumerate, PowerGetActiveScheme, PowerReadFriendlyName, PowerSetActiveScheme,
    ACCESS_SCHEME,
};

type PlaySoundSender = LazyLock<Mutex<Option<Sender<(String, f32)>>>>;

static PLAY_SOUND_TX: PlaySoundSender = LazyLock::new(Mutex::default);
static AUDIO_DEVICE_MANAGER: LazyLock<Mutex<Option<AudioDeviceManager>>> = LazyLock::new(Mutex::default);
static VRCHAT_ACTIVE: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));

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
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

pub async fn init_sound_playback() {
    // Create channels
    let (tokio_tx, mut tokio_rx) = tokio::sync::mpsc::channel::<(String, f32)>(32);
    let (std_tx, std_rx) = std::sync::mpsc::channel::<(String, f32)>();

    // Store the tokio sender
    *PLAY_SOUND_TX.lock().await = Some(tokio_tx);

    // Forward messages from tokio channel to std channel
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            while let Some(msg) = tokio_rx.recv().await {
                let _ = std_tx.send(msg);
            }
        });
    });

    // Spawn standard thread to play sounds
    std::thread::spawn(move || {
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

        // Initialize output stream
        let (_stream, stream_handle) = match OutputStream::try_default() {
            Ok((stream, handle)) => (stream, handle),
            Err(e) => {
                error!("[Core] Failed to initialize audio output stream: {}", e);
                return;
            }
        };

        // Play sounds when requested
        while let Ok((sound, volume)) = std_rx.recv() {
            if let Some(source) = sounds.get(&sound) {
                // Play sound
                let source = source.clone();
                let sink = match Sink::try_new(&stream_handle) {
                    Ok(s) => s,
                    Err(e) => {
                        error!("[Core] Failed to create audio sink: {}", e);
                        continue;
                    }
                };
                sink.set_volume(volume);
                sink.append(source.clone());
                sink.detach();
            } else {
                error!("[Core] Sound not found: {}", sound);
            }
        }
    });
}

/// Cleanup old batch files created by run_cmd_commands
pub async fn cleanup_batch_files() {
    let temp_dir = env::temp_dir();

    match tokio::fs::read_dir(&temp_dir).await {
        Ok(mut entries) => {
            let mut cleanup_count = 0;
            while let Ok(Some(entry)) = entries.next_entry().await {
                if let Some(filename) = entry.file_name().to_str() {
                    // Check if this is one of our batch files
                    if filename.starts_with("oyasumi_") && filename.ends_with(".bat") {
                        let file_path = entry.path();
                        match tokio::fs::remove_file(&file_path).await {
                            Ok(_) => {
                                cleanup_count += 1;
                            }
                            Err(e) => {
                                // Log but don't fail - file might be in use or already deleted
                                warn!("[Core] Could not remove batch file {:?}: {}", file_path, e);
                            }
                        }
                    }
                }
            }
            if cleanup_count > 0 {
                info!(
                    "[Core] Cleaned up {} old batch files from temp directory",
                    cleanup_count
                );
            }
        }
        Err(e) => {
            error!(
                "[Core] Failed to read temp directory for batch file cleanup: {}",
                e
            );
        }
    }
}

fn get_windows_power_policies() -> Vec<GUID> {
    let mut power_schemes = Vec::new();
    let mut index: u32 = 0;
    let mut buffer_size: u32 = std::mem::size_of::<GUID>() as u32;

    loop {
        let mut buffer: GUID = unsafe { std::mem::zeroed() };
        let result = unsafe {
            PowerEnumerate(
                None,
                None,
                None,
                ACCESS_SCHEME,
                index,
                Some(&mut buffer as *mut _ as *mut u8),
                &mut buffer_size as *mut _,
            )
        };

        if result == ERROR_SUCCESS {
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
        if PowerGetActiveScheme(None, &mut guid).is_ok() && !guid.is_null() {
            Some(*guid)
        } else {
            None
        }
    }
}

fn set_windows_power_policy(guid: &GUID) -> bool {
    let result = unsafe { PowerSetActiveScheme(None, Some(guid)) };
    if result.is_err() {
        error!(
            "[Core] Failed to set Windows power policy. Result code {:?}",
            result
        );
    };
    result.is_ok()
}

fn get_friendly_name_for_windows_power_policy(scheme_guid: &GUID) -> Option<String> {
    let mut buffer_size: u32 = 0;

    // First call to determine the buffer size needed
    let result = unsafe {
        PowerReadFriendlyName(
            None,
            Some(scheme_guid as *const _),
            None,
            None,
            None,
            &mut buffer_size,
        )
    };

    if result != ERROR_SUCCESS || buffer_size == 0 {
        return None;
    }

    let mut buffer: Vec<u8> = vec![0; buffer_size as usize];

    // Second call to actually get the friendly name
    let result = unsafe {
        PowerReadFriendlyName(
            None,
            Some(scheme_guid as *const _),
            None,
            None,
            Some(buffer.as_mut_ptr()),
            &mut buffer_size,
        )
    };

    if result != ERROR_SUCCESS {
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
