use std::{
    collections::HashMap,
    process::Command,
    sync::Mutex,
};

use log::error;
use serde::{Deserialize, Serialize};
use soloud::*;

lazy_static! {
    static ref SOUNDS: Mutex<HashMap<String, Vec<u8>>> = Mutex::new(HashMap::new());
    static ref SOLOUD: Mutex<Soloud> = Mutex::new(Soloud::default().unwrap());
}

pub fn load_sounds() {
    let mut sounds = SOUNDS.lock().unwrap();
    sounds.insert(
        String::from("notification_bell"),
        std::fs::read("sounds/notification_bell.ogg").unwrap(),
    );
    sounds.insert(
        String::from("notification_block"),
        std::fs::read("sounds/notification_block.ogg").unwrap(),
    );
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
pub async fn run_command(command: String, args: Vec<String>) -> Result<Output, String> {
    let output = match tauri::api::process::Command::new(command)
        .args(args)
        .output()
    {
        Ok(output) => output,
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
                // Re-enable once available on Rust stable: https://github.com/rust-lang/rust/issues/86442
                // std::io::ErrorKind::InvalidFilename => {
                //     return Err(String::from("INVALID_FILENAME"))
                // }
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

    Ok(Output {
        stdout: output.stdout,
        stderr: output.stderr,
        status: output.status.code().unwrap_or_default(),
    })
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Output {
    pub stdout: String,
    pub stderr: String,
    pub status: i32,
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
