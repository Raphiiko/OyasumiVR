#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

//! The OyasumiVR privileged launcher. Two jobs and no product logic.
//!
//! `--install`, run once with elevation, copies this binary into Program Files and registers a
//! triggerless scheduled task pointing at the copy. With no arguments, started by that task, it
//! verifies the elevated sidecar's signature, stages it into an admin-only directory, and runs it.

mod install;
mod paths;
mod run;
mod spawn;
mod verify;

use std::process::ExitCode;
use std::{fs::OpenOptions, path::Path};

/// The core reads these back from the scheduled task's `LastTaskResult`.
pub mod exit {
    pub const OK: u8 = 0;
    pub const NOT_ELEVATED: u8 = 10;
    pub const INSTALL_FAILED: u8 = 11;
    pub const TASK_REGISTRATION_FAILED: u8 = 12;
    pub const NO_HANDSHAKE: u8 = 20;
    pub const SIGNATURE_REJECTED: u8 = 21;
    pub const STAGING_FAILED: u8 = 22;
    pub const SPAWN_FAILED: u8 = 23;
}

pub fn log(message: &str) {
    ::log::info!("{message}");
}

fn init_logging() {
    let Ok(dir) = paths::log_dir() else { return };
    let _ = init_logging_at(&dir);
}

fn init_logging_at(dir: &Path) -> bool {
    let Ok(()) = oyasumivr_shared::windows::with_unelevated_token(|| prepare_log_file(dir)) else {
        return false;
    };
    oyasumivr_shared::logging::init(dir, "OyasumiVR_Privileged_Launcher", false).is_ok()
}

fn prepare_log_file(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("OyasumiVR_Privileged_Launcher.log"))?;
    Ok(())
}

fn main() -> ExitCode {
    init_logging();
    let install_requested = std::env::args().any(|a| a == "--install");
    let code = if install_requested {
        install::run()
    } else {
        run::run()
    };
    ExitCode::from(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_logging_at_creates_the_log_file() {
        let dir = std::env::temp_dir()
            .join("oyasumivr-launcher-log-test")
            .join(std::process::id().to_string());
        let _ = std::fs::remove_dir_all(&dir);
        assert!(init_logging_at(&dir));
        log::info!("test line");
        assert!(dir.join("OyasumiVR_Privileged_Launcher.log").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
