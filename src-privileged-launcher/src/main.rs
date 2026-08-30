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

use simplelog::{format_description, ConfigBuilder, LevelFilter, WriteLogger};

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
    let Ok(path) = paths::log_file() else { return };
    let _ = init_logging_at(&path);
}

fn init_logging_at(path: &Path) -> bool {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let Ok(file) = open_log_file(path) else {
        return false;
    };
    WriteLogger::init(LevelFilter::Info, log_config(), file).is_ok()
}

fn open_log_file(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT,
    };

    let mut current = std::path::PathBuf::new();
    for component in path.parent().into_iter().flat_map(Path::components) {
        current.push(component);
        if std::fs::symlink_metadata(&current)?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0
            != 0
        {
            return Err(std::io::Error::other(
                "the log directory contains a reparse point",
            ));
        }
    }
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)?;
    if file.metadata()?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        return Err(std::io::Error::other("the log file is a reparse point"));
    }
    Ok(file)
}

fn log_config() -> simplelog::Config {
    ConfigBuilder::new()
        .set_time_format_custom(format_description!(
            "[[[year]-[month]-[day]][[[hour]:[minute]:[second]]"
        ))
        .build()
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
    use ::log::{Level, Log, Record};
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl Write for Buffer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn log_lines_include_utc_date_time_and_level() {
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let logger = WriteLogger::new(LevelFilter::Info, log_config(), Buffer(bytes.clone()));
        logger.log(
            &Record::builder()
                .level(Level::Info)
                .args(format_args!("[run] started the sidecar"))
                .build(),
        );
        let line = String::from_utf8(bytes.lock().unwrap().clone()).unwrap();
        let shape: String = line[..22]
            .chars()
            .map(|c| if c.is_ascii_digit() { '#' } else { c })
            .collect();
        assert_eq!(shape, "[####-##-##][##:##:##]");
        assert_eq!(&line[22..], " [INFO] [run] started the sidecar\n");
    }

    #[test]
    fn elevated_logging_rejects_a_reparse_directory() {
        use std::os::windows::fs::symlink_dir;

        let root = std::env::temp_dir().join("oyasumivr-launcher-log-reparse");
        let _ = std::fs::remove_dir_all(&root);
        let real = root.join("real");
        let link = root.join("link");
        std::fs::create_dir_all(&real).unwrap();
        if symlink_dir(&real, &link).is_err() {
            return;
        }
        assert!(open_log_file(&link.join("launcher.log")).is_err());
    }
}
