use super::{models::Output, SOLOUD, SOUNDS};
use log::error;
use soloud::{audio, AudioExt, LoadExt};
use tauri::api::process::{Command, CommandEvent};

#[tauri::command]
pub fn check_dotnet_upgrades_required() -> Result<Vec<String>, String> {
    super::dotnet::check_dotnet_upgrades_required()
}

#[tauri::command]
pub fn get_net_core_version() -> Result<Option<String>, String> {
    super::dotnet::get_net_core_version()
}

#[tauri::command]
pub fn get_asp_net_core_version() -> Result<Option<String>, String> {
    super::dotnet::get_asp_net_core_version()
}

#[tauri::command]
pub fn is_semver_higher(a: String, b: String) -> Result<bool, String> {
    super::dotnet::is_semver_higher(&a, &b)
}

#[tauri::command]
pub async fn upgrade_net_core(version: String) -> Result<(), String> {
    super::dotnet::upgrade_net_core(&version).await
}

#[tauri::command]
pub async fn upgrade_asp_net_core(version: String) -> Result<(), String> {
    super::dotnet::upgrade_asp_net_core(&version).await
}

#[tauri::command]
pub fn play_sound(name: String) {
    std::thread::spawn(move || {
        let mut wav = audio::Wav::default();
        {
            let sound_data_guard = SOUNDS.lock().unwrap();
            let sound_data = sound_data_guard.get(&name).unwrap();
            wav.load_mem(sound_data).unwrap();
        }
        {
            let sl = SOLOUD.lock().unwrap();
            sl.play(&wav);
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
