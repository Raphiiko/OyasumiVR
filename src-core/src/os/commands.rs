use super::{audio_devices::device::AudioDeviceDto, models::Output, SOLOUD, SOUNDS};
use log::{error, info};
use soloud::{audio, AudioExt, LoadExt};
use tauri::api::process::{Command, CommandEvent};

#[tauri::command]
pub fn play_sound(name: String, volume: f32) {
    if volume == 0.0 {
        return;
    }
    std::thread::spawn(move || {
        let mut wav = audio::Wav::default();
        {
            let sound_data_guard = SOUNDS.lock().unwrap();
            let sound_data = sound_data_guard.get(&name).unwrap();
            wav.load_mem(sound_data).unwrap();
        }
        {
            let sl = SOLOUD.lock().unwrap();
            sl.play_ex(&wav, volume, 0.0, false, unsafe {
                soloud::Handle::from_raw(0)
            });
        }
        loop {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let sl = SOLOUD.lock().unwrap();
            if sl.active_voice_count() == 0 {
                break;
            }
        }
    });
}

#[tauri::command]
pub async fn quit_steamvr(kill: bool) {
    crate::utils::stop_process("vrmonitor.exe", kill).await;
}

#[tauri::command]
pub async fn run_command(command: String, args: Vec<String>) -> Result<Output, String> {
    let command = tauri::api::process::Command::new(command).args(args);
    let (mut rx, _child) = match command.spawn() {
        Ok(child) => child,
        Err(error) => match error {
            tauri::api::Error::Io(io_err) => match io_err.kind() {
                std::io::ErrorKind::NotFound => {
                    error!("[Core] [run_command] Executable not found: {}", io_err);
                    return Err(String::from("NOT_FOUND"));
                }
                std::io::ErrorKind::PermissionDenied => {
                    error!("[Core] [run_command] Permission Denied: {}", io_err);
                    return Err(String::from("PERMISSION_DENIED"));
                }
                other => {
                    error!(
                        "[Core] [run_command] Unknown IO error occurred: (kind={}, error={})",
                        other, io_err
                    );
                    return Err(String::from("UNKNOWN_ERROR"));
                }
            },
            other => {
                error!("[Core] [run_command] Unknown error occurred: {}", other);
                return Err(String::from("UNKNOWN_ERROR"));
            }
        },
    };
    let mut stdout: Vec<String> = Vec::new();
    let mut stderr: Vec<String> = Vec::new();
    let mut status = -1;
    while let Some(event) = rx.recv().await {
        match &event {
            CommandEvent::Stdout(line) => {
                stdout.push(line.clone());
            }
            CommandEvent::Stderr(line) => {
                stderr.push(line.clone());
            }
            CommandEvent::Terminated(payload) => {
                status = payload.code.unwrap_or(-1);
            }
            _ => {}
        }
    }
    Ok(Output {
        stdout: stdout.join("\n"),
        stderr: stderr.join("\n"),
        status,
    })
}

#[tauri::command]
pub async fn show_in_folder(path: String) {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path]) // The comma after select is not a typo
            .spawn()
            .unwrap();
    }

    #[cfg(target_os = "linux")]
    {
        if path.contains(",") {
            // see https://gitlab.freedesktop.org/dbus/dbus/-/issues/76
            let new_path = match metadata(&path).unwrap().is_dir() {
                true => path,
                false => {
                    let mut path2 = PathBuf::from(path);
                    path2.pop();
                    path2.into_os_string().into_string().unwrap()
                }
            };
            Command::new("xdg-open").arg(&new_path).spawn().unwrap();
        } else {
            Command::new("dbus-send")
                .args([
                    "--session",
                    "--dest=org.freedesktop.FileManager1",
                    "--type=method_call",
                    "/org/freedesktop/FileManager1",
                    "org.freedesktop.FileManager1.ShowItems",
                    format!("array:string:\"file://{path}\"").as_str(),
                    "string:\"\"",
                ])
                .spawn()
                .unwrap();
        }
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open").args(["-R", &path]).spawn().unwrap();
    }
}

#[tauri::command]
pub async fn set_windows_power_policy(policy: String) {
    let guid = match policy.as_str() {
        "POWER_SAVING" => super::GUID_POWER_POLICY_POWER_SAVING,
        "BALANCED" => super::GUID_POWER_POLICY_BALANCED,
        "HIGH_PERFORMANCE" => super::GUID_POWER_POLICY_HIGH_PERFORMANCE,
        _ => panic!("Unknown power policy: {}", policy),
    };
    info!("[Core] Setting Windows power policy to \"{}\" plan", policy);
    super::set_windows_power_policy(&guid);
}

#[tauri::command]
pub async fn active_windows_power_policy() -> Option<String> {
    let guid = super::active_windows_power_policy();
    if guid.is_none() {
        return None;
    }
    let guid = guid.unwrap();
    if super::guid_equal(&guid, &super::GUID_POWER_POLICY_POWER_SAVING) {
        return Some(String::from("POWER_SAVING"));
    }
    if super::guid_equal(&guid, &super::GUID_POWER_POLICY_BALANCED) {
        return Some(String::from("BALANCED"));
    }
    if super::guid_equal(&guid, &super::GUID_POWER_POLICY_HIGH_PERFORMANCE) {
        return Some(String::from("HIGH_PERFORMANCE"));
    }
    None
}

#[tauri::command]
pub fn windows_shutdown(message: &str, timeout: u32, force_close_apps: bool) {
    let _ = system_shutdown::shutdown_with_message(message, timeout, force_close_apps);
}

#[tauri::command]
pub fn windows_reboot(message: &str, timeout: u32, force_close_apps: bool) {
    let _ = system_shutdown::reboot_with_message(message, timeout, force_close_apps);
}

#[tauri::command]
pub fn windows_sleep() {
    let _ = system_shutdown::sleep();
}

#[tauri::command]
pub fn windows_hibernate() {
    let _ = system_shutdown::hibernate();
}

#[tauri::command]
pub fn windows_logout() {
    let _ = system_shutdown::logout();
}

#[tauri::command]
pub async fn get_audio_devices(refresh: bool) -> Vec<AudioDeviceDto> {
    let manager_guard = super::AUDIO_DEVICE_MANAGER.lock().await;
    let manager = match manager_guard.as_ref() {
        Some(m) => m,
        None => {
            error!(
                "[Core] Could not get audio devices, as audio device manager was not initialized"
            );
            return vec![];
        }
    };
    if refresh {
        if let Err(e) = manager.refresh_audio_devices().await {
            error!("[Core] Failed to refresh audio devices: {}", e);
        }
    }
    manager.get_devices().await
}

#[tauri::command]
pub async fn set_audio_device_volume(device_id: String, volume: f32) {
    let manager_guard = super::AUDIO_DEVICE_MANAGER.lock().await;
    let manager = match manager_guard.as_ref() {
        Some(m) => m,
        None => {
            error!(
              "[Core] Could not set audio device volume, as audio device manager was not initialized"
          );
            return;
        }
    };
    manager.set_volume(device_id, volume).await;
}

#[tauri::command]
pub async fn set_audio_device_mute(device_id: String, mute: bool) {
    let manager_guard = super::AUDIO_DEVICE_MANAGER.lock().await;
    let manager = match manager_guard.as_ref() {
        Some(m) => m,
        None => {
            error!(
              "[Core] Could not set audio device mute state, as audio device manager was not initialized"
          );
            return;
        }
    };
    manager.set_mute(device_id, mute).await;
}

#[tauri::command]
pub async fn set_hardware_mic_activity_enabled(enabled: bool) {
    let manager_guard = super::AUDIO_DEVICE_MANAGER.lock().await;
    let manager = match manager_guard.as_ref() {
        Some(m) => m,
        None => {
            error!(
              "[Core] Could not enable/disable hardware mic activation, as audio device manager was not initialized"
          );
            return;
        }
    };
    manager.set_mic_activity_enabled(enabled).await;
}

#[tauri::command]
pub async fn set_hardware_mic_activivation_threshold(threshold: f32) {
    let manager_guard = super::AUDIO_DEVICE_MANAGER.lock().await;
    let manager = match manager_guard.as_ref() {
        Some(m) => m,
        None => {
            error!(
              "[Core] Could not set the hardware mic activation threshold, as audio device manager was not initialized"
          );
            return;
        }
    };
    manager.set_mic_activation_threshold(threshold).await;
}


#[tauri::command]
pub async fn set_mic_activity_device_id(device_id: Option<String>) {
    let manager_guard = super::AUDIO_DEVICE_MANAGER.lock().await;
    let manager = match manager_guard.as_ref() {
        Some(m) => m,
        None => {
            error!(
              "[Core] Could not set active capture device ID, as audio device manager was not initialized"
          );
            return;
        }
    };
    manager.set_mic_activity_device_id(device_id).await;
}
