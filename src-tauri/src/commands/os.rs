use crate::models;

#[tauri::command]
pub async fn run_command(command: String, args: Vec<String>) -> Result<models::Output, String> {
    let output = match tauri::api::process::Command::new(command)
        .args(args)
        .output()
    {
        Ok(output) => output,
        Err(error) => match error {
            tauri::api::Error::Io(io_err) => match io_err.kind() {
                std::io::ErrorKind::NotFound => return Err(String::from("NOT_FOUND")),
                std::io::ErrorKind::PermissionDenied => {
                    return Err(String::from("PERMISSION_DENIED"))
                }
                std::io::ErrorKind::InvalidFilename => {
                    return Err(String::from("INVALID_FILENAME"))
                }
                other => {
                    eprintln!("Unknown IO Error occurred: {}", other);
                    return Err(String::from("UNKNOWN_ERROR"));
                }
            },
            other => {
                eprintln!("Unknown error occurred: {}", other);
                return Err(String::from("UNKNOWN_ERROR"));
            }
        },
    };

    Ok(models::Output {
        stdout: output.stdout,
        stderr: output.stderr,
        status: output.status.code().unwrap_or_default(),
    })
}