use std::io::{Error, ErrorKind, Result};
use std::path::PathBuf;

pub const SIDECAR_EXE: &str = "oyasumivr-elevated-sidecar.exe";
pub const LAUNCHER_EXE: &str = "oyasumivr-privileged-launcher.exe";

/// Everything below lives under Program Files. Only administrators may write here, which is what
/// makes it safe to execute a staged sidecar: its own directory is a DLL search location.
pub fn privileged_dir() -> Result<PathBuf> {
    let program_files = std::env::var("ProgramFiles")
        .map_err(|_| Error::new(ErrorKind::NotFound, "ProgramFiles is not set"))?;
    Ok(PathBuf::from(program_files)
        .join("OyasumiVR")
        .join("privileged"))
}

pub fn installed_launcher() -> Result<PathBuf> {
    Ok(privileged_dir()?.join(LAUNCHER_EXE))
}

pub fn launcher_marker() -> Result<PathBuf> {
    Ok(privileged_dir()?.join("launcher.json"))
}

pub fn log_file() -> Result<PathBuf> {
    Ok(privileged_dir()?.join("launcher.log"))
}

pub fn staged_root() -> Result<PathBuf> {
    Ok(privileged_dir()?.join("staged"))
}

/// One directory per distinct sidecar build, named after its signature. Nothing is overwritten, so
/// a running sidecar cannot block a new one being staged.
pub fn staged_dir(signature_id: &str) -> Result<PathBuf> {
    Ok(staged_root()?.join(signature_id))
}
