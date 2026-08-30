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
    let Ok(path) = paths::log_file() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // best effort: the exit code carries the outcome regardless
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        use std::io::Write;
        let _ = writeln!(file, "{message}");
    }
}

fn main() -> ExitCode {
    let install_requested = std::env::args().any(|a| a == "--install");
    let code = if install_requested {
        install::run()
    } else {
        run::run()
    };
    ExitCode::from(code)
}
