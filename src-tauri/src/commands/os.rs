use serde::{Deserialize, Serialize};
use log::{error};

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
