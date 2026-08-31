use std::io::{Error, ErrorKind, Result};
use std::path::{Path, PathBuf};

pub const SIDECAR_EXE: &str = "oyasumivr-elevated-sidecar.exe";
pub const LAUNCHER_EXE: &str = "oyasumivr-privileged-launcher.exe";

/// Everything below lives under Program Files. Only administrators may write here, which is what
/// makes it safe to execute a staged sidecar: its own directory is a DLL search location.
pub fn privileged_dir() -> Result<PathBuf> {
    Ok(oyasumivr_shared::windows::program_files()?
        .join("OyasumiVR")
        .join("privileged"))
}

pub fn installed_launcher() -> Result<PathBuf> {
    Ok(privileged_dir()?.join(LAUNCHER_EXE))
}

pub fn launcher_marker() -> Result<PathBuf> {
    Ok(privileged_dir()?.join("launcher.json"))
}

pub fn log_dir() -> Result<PathBuf> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .ok_or_else(|| Error::new(ErrorKind::NotFound, "LOCALAPPDATA is not set"))?;
    Ok(log_dir_in(local_app_data))
}

fn log_dir_in(local_app_data: impl AsRef<Path>) -> PathBuf {
    local_app_data
        .as_ref()
        .join("co.raphii.oyasumi")
        .join("logs")
}

/// Holds one directory per distinct sidecar build, named after its signature. Nothing is
/// overwritten, so a running sidecar cannot block a new one being staged.
pub fn staged_root() -> Result<PathBuf> {
    Ok(privileged_dir()?.join("staged"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launcher_log_uses_the_shared_log_directory() {
        assert_eq!(
            log_dir_in(PathBuf::from(r"C:\Users\test\AppData\Local")),
            PathBuf::from(r"C:\Users\test\AppData\Local\co.raphii.oyasumi\logs")
        );
    }
}
