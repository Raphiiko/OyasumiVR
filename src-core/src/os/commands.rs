use super::{
    audio_devices::device::AudioDeviceDto,
    get_friendly_name_for_windows_power_policy,
    models::{Output, WindowsPowerPolicy},
    VRCHAT_ACTIVE,
};
use log::{error, info};
use tauri::api::process::{Command, CommandEvent};

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn play_sound(name: String, volume: f32) {
    if volume == 0.0 {
        return;
    }
    let guard = super::PLAY_SOUND_TX.lock().await;
    let tx = match guard.as_ref() {
        Some(tx) => tx,
        None => {
            error!("[Core] Could not play sound, as sound player was not initialized");
            return;
        }
    };
    let _ = tx.send((name, volume)).await;
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn quit_steamvr(kill: bool) {
    crate::utils::stop_process("vrmonitor.exe", kill).await;
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn is_vrchat_active() -> bool {
    let vrc_active_guard = VRCHAT_ACTIVE.lock().await;
    *vrc_active_guard
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
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
#[oyasumivr_macros::command_profiling]
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
#[oyasumivr_macros::command_profiling]
pub async fn set_windows_power_policy(guid: String) {
    let guid = guid.to_uppercase();
    let parsed_guid = match crate::utils::serialization::string_to_guid(&guid) {
        Ok(g) => g,
        Err(e) => {
            error!(
                "[Core] Could not parse GUID in set_windows_power_policy \"{}\": {}",
                guid, e
            );
            return;
        }
    };
    info!("[Core] Setting Windows power policy to \"{}\" plan", guid);
    super::set_windows_power_policy(&parsed_guid);
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn active_windows_power_policy() -> Option<WindowsPowerPolicy> {
    let guid = super::active_windows_power_policy();
    if guid.is_none() {
        return None;
    }
    let guid = guid.unwrap();
    let name = get_friendly_name_for_windows_power_policy(&guid);
    Some(WindowsPowerPolicy {
        guid: crate::utils::serialization::guid_to_string(&guid),
        name: name.unwrap_or(String::from("Unknown Policy")),
    })
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn get_windows_power_policies() -> Vec<WindowsPowerPolicy> {
    let mut policies = Vec::new();
    let schemes = super::get_windows_power_policies();
    for scheme in schemes {
        let name = get_friendly_name_for_windows_power_policy(&scheme);
        policies.push(WindowsPowerPolicy {
            guid: crate::utils::serialization::guid_to_string(&scheme),
            name: name.unwrap_or(String::from("Unknown Policy")),
        });
    }
    policies
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn windows_shutdown(message: String, timeout: u32, force_close_apps: bool) {
    let _ = system_shutdown::shutdown_with_message(&message, timeout, force_close_apps);
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn windows_reboot(message: String, timeout: u32, force_close_apps: bool) {
    let _ = system_shutdown::reboot_with_message(&message, timeout, force_close_apps);
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn windows_sleep() {
    let _ = system_shutdown::sleep();
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn windows_hibernate() {
    let _ = system_shutdown::hibernate();
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn windows_logout() {
    let _ = system_shutdown::logout();
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
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
#[oyasumivr_macros::command_profiling]
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
#[oyasumivr_macros::command_profiling]
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
#[oyasumivr_macros::command_profiling]
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
#[oyasumivr_macros::command_profiling]
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
#[oyasumivr_macros::command_profiling]
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

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn activate_memory_watcher() -> bool {
    let mut watcher_active_guard = super::MEMORY_WATCHER_ACTIVE.lock().await;
    if *watcher_active_guard {
        return false;
    }
    info!("[Core] Activating memory watcher");
    *watcher_active_guard = true;
    true
}
