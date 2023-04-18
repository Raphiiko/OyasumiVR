use std::{path::PathBuf, sync::Mutex};

use log::info;

lazy_static! {
    pub static ref LOG_DIR: Mutex<Option<PathBuf>> = Default::default();
}

#[tauri::command]
pub fn clean_log_files() {
    info!("[Core] Deleting log files...");
    // Delete all log files in the log directory
    let guard = LOG_DIR.lock().unwrap();
    let log_dir = guard.as_ref().unwrap();
    let mut logs_deleted = 0;
    for entry in std::fs::read_dir(log_dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_file() {
            std::fs::remove_file(path).unwrap();
            logs_deleted += 1;
        }
    }
    info!("[Core] Deleted {} log file(s)", logs_deleted);
}
