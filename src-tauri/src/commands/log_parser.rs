use std::sync::{mpsc, Mutex};

use log::info;

use crate::modules;

lazy_static! {
    static ref TERMINATION_TX: Mutex<Option<mpsc::Sender<()>>> = Default::default();
}

#[tauri::command]
pub fn init_vrc_log_watcher() {
    info!("[Core] Initializing VRChat Log Watcher...");
    // Terminate existing thread if it exists
    let termination_guard = TERMINATION_TX.lock().unwrap();
    let termination = termination_guard.as_ref();
    if let Some(t) = termination {
        t.send(()).unwrap();
    }
    drop(termination_guard);
    // Start new parser thread
    let termination = modules::log_parser::spawn_log_parser_thread();
    *TERMINATION_TX.lock().unwrap() = Some(termination);
}
