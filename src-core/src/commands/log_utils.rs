use log::{error, info};
use std::{path::PathBuf, sync::LazyLock, time::SystemTime};
use tokio::sync::Mutex;

pub static LOG_DIR: LazyLock<Mutex<Option<PathBuf>>> = LazyLock::new(Default::default);

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
        if path.is_file() && std::fs::remove_file(path).is_ok() {
            logs_deleted += 1;
        }
    }
    info!("[Core] Deleted {logs_deleted} log file(s)");
}

pub async fn print_file_debug_data(path: PathBuf) {
    error!("<FILE DEBUG DATA>");
    error!("Path: {path:?}");
    let now = SystemTime::now();
    error!("System Time: {now:?}");
    // Print now as unix time
    match now.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(duration) => {
            error!("System Time [UNIX]: {}", duration.as_secs())
        }
        Err(e) => {
            error!("Error getting unix time for now: {e}");
        }
    };
    match std::fs::metadata(&path) {
        Ok(metadata) => {
            // Print modified time
            match metadata.modified() {
                Ok(modified) => {
                    error!("Modified Time: {modified:?}");
                    match modified.elapsed() {
                        Ok(elapsed) => {
                            error!("Elapsed Time: {elapsed:?}");
                        }
                        Err(e) => {
                            error!("Error getting elapsed time for log file: {e}");
                        }
                    };
                }
                Err(e) => {
                    error!("Error getting modified time for log file: {e}");
                }
            };
            // Print elapsed time
            match metadata.modified() {
                Ok(modified) => match modified.elapsed() {
                    Ok(elapsed) => {
                        error!("Elapsed Time [UNIX]: {}", elapsed.as_secs());
                    }
                    Err(e) => {
                        error!("Error getting elapsed time for log file: {e}");
                    }
                },
                Err(e) => {
                    error!("Error getting modified time for log file: {e}");
                }
            };
            // Print modified as unix time
            match metadata
                .modified()
                .unwrap()
                .duration_since(SystemTime::UNIX_EPOCH)
            {
                Ok(duration) => {
                    error!("Modified Time [UNIX]: {}", duration.as_secs())
                }
                Err(e) => {
                    error!("Error getting unix time for modified: {e}");
                }
            };
        }
        Err(e) => {
            error!("Error getting metadata for log file: {e}");
        }
    };
    error!("</FILE DEBUG DATA>");
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
            let too_old = match metadata.modified() {
                Ok(modified) => match modified.elapsed() {
                    Ok(elapsed) => elapsed.as_secs() > 60 * 60 * 24 * 30, // 30 Days
                    Err(e) => {
                        error!("Error getting elapsed time for log file: {e}");
                        print_file_debug_data(path.clone()).await;
                        false
                    }
                },
                Err(e) => {
                    error!("Error getting modified time for log file: {e}");
                    print_file_debug_data(path.clone()).await;
                    false
                }
            };
            if (too_large || too_old) && std::fs::remove_file(path.clone()).is_ok() {
                logs_deleted += 1;
            }
        }
    }
    info!("[Core] Deleted {logs_deleted} log file(s)");
}
