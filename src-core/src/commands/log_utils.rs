use log::info;
use std::path::PathBuf;
use tokio::sync::Mutex;

lazy_static! {
    pub static ref LOG_DIR: Mutex<Option<PathBuf>> = Default::default();
}

pub async fn init(path: PathBuf) {
    *LOG_DIR.lock().await = Some(path);
}

#[tauri::command]
pub async fn clean_log_files() {
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
