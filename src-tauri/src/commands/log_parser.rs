use std::sync::{mpsc, Mutex};

use crate::background;

lazy_static! {
    static ref TERMINATION_TX: Mutex<Option<mpsc::Sender<()>>> = Default::default();
}

#[tauri::command]
pub fn init_vrc_log_watcher() {
    // Terminate existing thread if it exists
    let termination_guard = TERMINATION_TX.lock().unwrap();
    let termination = termination_guard.as_ref();
    if termination.is_some() {
        termination.unwrap().send(()).unwrap();
    }
    drop(termination_guard);
    // Start new parser thread
    let termination = background::log_parser::spawn_log_parser_thread();
    *TERMINATION_TX.lock().unwrap() = Some(termination);
}
