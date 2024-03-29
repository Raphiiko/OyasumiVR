use log::info;
use std::path::PathBuf;
use tokio::sync::Mutex;

lazy_static! {
    pub static ref LOG_DIR: Mutex<Option<PathBuf>> = Default::default();
}

pub async fn init(path: PathBuf) {
    *LOG_DIR.lock().await = Some(path);
    clean_log_files().await;
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn clear_log_files() {
    info!("[Core] Deleting log files...");
    // Delete all log files in the log directory
    let guard = LOG_DIR.lock().await;
    let log_dir = guard.as_ref().unwrap();
    let mut logs_deleted = 0;
    for entry in std::fs::read_dir(log_dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_file() {
            if std::fs::remove_file(path).is_ok() {
                logs_deleted += 1;
            }
        }
    }
    info!("[Core] Deleted {} log file(s)", logs_deleted);
}

pub async fn clean_log_files() {
    info!("[Core] Cleaning old and oversized log files...");
    let guard = LOG_DIR.lock().await;
    let log_dir = guard.as_ref().unwrap();
    let mut logs_deleted = 0;
    for entry in std::fs::read_dir(log_dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_file() {
            let metadata = std::fs::metadata(&path).unwrap();
            let too_large = metadata.len() > 10 * 1024 * 1024; // 10 MB
            let too_old =
                metadata.modified().unwrap().elapsed().unwrap().as_secs() > 60 * 60 * 24 * 30; // 30 Days
            if too_large || too_old {
                if std::fs::remove_file(path).is_ok() {
                    logs_deleted += 1;
                }
            }
        }
    }
    info!("[Core] Deleted {} log file(s)", logs_deleted);
}
