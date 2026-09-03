mod audio_devices;
pub mod commands;
pub mod elevation;
mod models;
mod sounds_gen;

use self::audio_devices::manager::AudioDeviceManager;
use log::{error, info, warn};
use rodio::buffer::SamplesBuffer;
use rodio::source::Source;
use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player};
use std::collections::HashMap;
use std::env;
use std::ffi::OsString;
use std::fs::File;
use std::io::BufReader;
use std::os::windows::ffi::OsStringExt;
use std::slice;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::sync::mpsc::{Receiver, Sender};
use tokio::sync::{oneshot, Mutex};
use windows::core::GUID;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Power::{
    PowerEnumerate, PowerGetActiveScheme, PowerReadFriendlyName, PowerSetActiveScheme,
    ACCESS_SCHEME,
};
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

type PlaySoundRequest = (String, f32, oneshot::Sender<Result<(), String>>);
type PlaySoundSender = LazyLock<Mutex<Option<Sender<PlaySoundRequest>>>>;

static PLAY_SOUND_TX: PlaySoundSender = LazyLock::new(Mutex::default);
static AUDIO_DEVICE_MANAGER: LazyLock<Mutex<Option<AudioDeviceManager>>> =
    LazyLock::new(Mutex::default);
static VRCHAT_ACTIVE: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));

pub async fn init_audio_device_manager() {
    let mut manager = AUDIO_DEVICE_MANAGER.lock().await;
    if manager.is_some() {
        return;
    }
    let m = match AudioDeviceManager::create().await {
        Ok(m) => m,
        Err(e) => {
            error!("[Core] Failed to create audio device manager: {e}");
            return;
        }
    };
    *manager = Some(m);
    if let Err(e) = manager.as_ref().unwrap().refresh_audio_devices().await {
        error!("[Core] Failed to refresh audio devices: {e}");
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

fn decode_sound_file(path: &str) -> Result<SamplesBuffer, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let decoder = Decoder::new(BufReader::new(file)).map_err(|e| e.to_string())?;
    let channels = decoder.channels();
    let sample_rate = decoder.sample_rate();
    let samples: Vec<f32> = decoder.collect();
    Ok(SamplesBuffer::new(channels, sample_rate, samples))
}

pub async fn init_sound_playback() {
    let (tx, rx) = tokio::sync::mpsc::channel::<PlaySoundRequest>(32);
    *PLAY_SOUND_TX.lock().await = Some(tx);

    std::thread::spawn(move || {
        run_playback_worker(rx, load_bundled_sounds(), || {
            DeviceSinkBuilder::open_default_sink().map_err(|e| e.to_string())
        });
    });
}

fn load_bundled_sounds() -> HashMap<String, SamplesBuffer> {
    let mut sounds = HashMap::new();
    for sound in sounds_gen::SOUND_FILES {
        let path = format!("resources/sounds/{sound}.ogg");
        match decode_sound_file(&path) {
            Ok(buffer) => {
                sounds.insert(String::from(*sound), buffer);
            }
            Err(e) => error!("[Core] Failed to load sound file ({path}): {e}"),
        }
    }
    sounds
}

/// An output sink the playback worker can send decoded audio to.
trait SoundSink {
    fn play(&self, buffer: SamplesBuffer, volume: f32);
}

impl SoundSink for MixerDeviceSink {
    fn play(&self, buffer: SamplesBuffer, volume: f32) {
        let player = Player::connect_new(self.mixer());
        player.set_volume(volume);
        player.append(buffer);
        player.detach();
    }
}

/// Runs until the sender is dropped, so a sink that cannot open yet never ends the worker.
fn run_playback_worker<S: SoundSink>(
    mut rx: Receiver<PlaySoundRequest>,
    sounds: HashMap<String, SamplesBuffer>,
    mut open_sink: impl FnMut() -> Result<S, String>,
) {
    let mut sink: Option<S> = None;
    while let Some((sound, volume, respond)) = rx.blocking_recv() {
        let result = match sounds.get(&sound) {
            Some(buffer) => play_on_sink(&mut sink, &mut open_sink, buffer, volume),
            None => Err(format!("sound not found: {sound}")),
        };
        if let Err(e) = &result {
            error!("[Core] Could not play sound \"{sound}\": {e}");
        }
        let _ = respond.send(result);
    }
}

fn play_on_sink<S: SoundSink>(
    sink: &mut Option<S>,
    open_sink: &mut impl FnMut() -> Result<S, String>,
    buffer: &SamplesBuffer,
    volume: f32,
) -> Result<(), String> {
    // acquire the sink on the first request, and again after every failed attempt
    if sink.is_none() {
        *sink = Some(open_sink()?);
    }
    sink.as_ref().unwrap().play(buffer.clone(), volume);
    Ok(())
}

/// Must run before the first desktop notification, or Windows drops it.
pub fn register_notification_app_id(app_handle: &tauri::AppHandle) {
    let config = app_handle.config();
    let app_id = config.identifier.clone();
    let display_name = config
        .product_name
        .clone()
        .unwrap_or_else(|| app_id.clone());
    let icon_uri = std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.parent()
                .map(|dir| dir.join("resources").join("icon.png"))
        })
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().into_owned());
    let result = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(format!("Software\\Classes\\AppUserModelId\\{app_id}"))
        .and_then(|(key, _)| {
            key.set_value("DisplayName", &display_name)?;
            match &icon_uri {
                Some(icon_uri) => key.set_value("IconUri", icon_uri),
                None => Ok(()),
            }
        });
    match result {
        Ok(()) => info!("[Core] Registered notification app id \"{app_id}\""),
        Err(e) => error!("[Core] Failed to register notification app id \"{app_id}\": {e}"),
    }
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
                                warn!("[Core] Could not remove batch file {file_path:?}: {e}");
                            }
                        }
                    }
                }
            }
            if cleanup_count > 0 {
                info!("[Core] Cleaned up {cleanup_count} old batch files from temp directory");
            }
        }
        Err(e) => {
            error!("[Core] Failed to read temp directory for batch file cleanup: {e}");
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
        error!("[Core] Failed to set Windows power policy. Result code {result:?}");
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::num::{NonZeroU16, NonZeroU32};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    struct FakeSink {
        played: Arc<AtomicUsize>,
    }

    impl SoundSink for FakeSink {
        fn play(&self, _buffer: SamplesBuffer, _volume: f32) {
            self.played.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn test_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    async fn request(tx: &Sender<PlaySoundRequest>, sound: &str) -> Result<(), String> {
        let (respond_tx, respond_rx) = oneshot::channel();
        tx.send((String::from(sound), 1.0, respond_tx))
            .await
            .unwrap();
        respond_rx.await.unwrap()
    }

    #[test]
    fn playback_worker_retries_sink_acquisition_after_a_failure() {
        let (tx, rx) = tokio::sync::mpsc::channel::<PlaySoundRequest>(4);
        let sounds = HashMap::from([(
            String::from("test"),
            SamplesBuffer::new(
                NonZeroU16::new(1).unwrap(),
                NonZeroU32::new(48_000).unwrap(),
                vec![0.5f32; 16],
            ),
        )]);
        let attempts = Arc::new(AtomicUsize::new(0));
        let played = Arc::new(AtomicUsize::new(0));

        let worker = std::thread::spawn({
            let attempts = attempts.clone();
            let played = played.clone();
            move || {
                run_playback_worker(rx, sounds, move || {
                    if attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                        Err(String::from("no usable sink"))
                    } else {
                        Ok(FakeSink {
                            played: played.clone(),
                        })
                    }
                })
            }
        });

        test_runtime().block_on(async {
            assert_eq!(
                request(&tx, "test").await,
                Err(String::from("no usable sink")),
                "the first request must report the sink failure"
            );
            assert_eq!(
                request(&tx, "test").await,
                Ok(()),
                "a later request must retry sink acquisition and play"
            );
            assert_eq!(
                request(&tx, "test").await,
                Ok(()),
                "the acquired sink must be reused"
            );
            assert_eq!(
                request(&tx, "missing").await,
                Err(String::from("sound not found: missing")),
                "an unknown sound must report an error"
            );
        });

        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert_eq!(played.load(Ordering::SeqCst), 2);

        drop(tx);
        worker.join().unwrap();
    }

    #[test]
    fn play_sound_command_errors_when_the_worker_stopped() {
        test_runtime().block_on(async {
            let (tx, rx) = tokio::sync::mpsc::channel::<PlaySoundRequest>(1);
            drop(rx);
            *PLAY_SOUND_TX.lock().await = Some(tx);
            assert_eq!(
                commands::play_sound(String::from("pebbles"), 1.0).await,
                Err(String::from("the sound playback worker is not running"))
            );
            *PLAY_SOUND_TX.lock().await = None;
            assert_eq!(
                commands::play_sound(String::from("pebbles"), 1.0).await,
                Err(String::from("sound playback is not initialized"))
            );
        });
    }

    #[test]
    fn bundled_sounds_decode_to_non_silent_samples() {
        for entry in std::fs::read_dir("resources/sounds").unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("ogg") {
                continue;
            }
            let buffer = decode_sound_file(path.to_str().unwrap()).unwrap();
            let mut count = 0usize;
            let mut peak = 0.0f32;
            for sample in buffer.take(48_000) {
                count += 1;
                peak = peak.max(sample.abs());
            }
            assert!(
                count > 1_000,
                "{} yielded only {count} samples",
                path.display()
            );
            assert!(
                peak > 0.001,
                "{} decoded as silent (peak {peak})",
                path.display()
            );
        }
    }
}
