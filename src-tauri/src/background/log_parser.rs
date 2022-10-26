use std::{
    fs::File,
    io::{BufRead, BufReader},
    os::windows::prelude::MetadataExt,
    sync::{
        mpsc::{self, TryRecvError},
        Arc,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::TAURI_WINDOW;
use chrono::{Local, NaiveDateTime, TimeZone};
use log::{debug, info, trace, warn};
use serde::{Deserialize, Serialize};
use tauri::{api::path::home_dir, Manager};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct VRCLogEvent {
    time: u64,
    event: String,
    data: String,
    initial_load: bool,
}

static mut MUTE_LOG_DIR_NO_EXIST_WARNINGS: bool = false;

fn get_latest_log_path() -> Option<String> {
    // Get all files in the log directory
    let dir = tauri::api::dir::read_dir(
        home_dir()
            .unwrap()
            .join("AppData\\LocalLow\\VRChat\\VRChat"),
        false,
    );
    // If log directory doesn't exist, return no path
    unsafe {
        if dir.is_err() {
            if !MUTE_LOG_DIR_NO_EXIST_WARNINGS {
                warn!("[Core] VRChat log directory doesn't exist (yet)");
                MUTE_LOG_DIR_NO_EXIST_WARNINGS = true;
            }
            return None;
        }
        MUTE_LOG_DIR_NO_EXIST_WARNINGS = false;
    }
    // Get the latest log file
    dir.unwrap()
        .iter()
        // Only get log files
        .filter(|entry| {
            let name = entry.name.as_ref().unwrap();
            name.starts_with("output_log_") && name.ends_with(".txt")
        })
        // Find most recent log file
        .max_by_key(|entry| entry.path.metadata().unwrap().creation_time())
        // Get the path for it
        .map(|entry| String::from(entry.path.to_str().unwrap()))
}

fn parse_datetime_from_line(line: String) -> u64 {
    let localtime = NaiveDateTime::parse_from_str(&line[0..19], "%Y.%m.%d %H:%M:%S").unwrap();
    let time = Local.from_local_datetime(&localtime).unwrap();
    time.timestamp_millis() as u64
}

fn process_log_line(line: String, initial_load: bool) {
    let parsers: Vec<fn(String, bool) -> bool> = vec![
        parse_on_player_joined,
        parse_on_player_left,
        parse_on_location_change,
    ];
    parsers
        .iter()
        .find(|parser| parser(line.clone(), initial_load));
}

fn parse_on_player_joined(line: String, initial_load: bool) -> bool {
    if line.contains("[Behaviour] OnPlayerJoined") && !line.contains("] OnPlayerJoined:") {
        let mut offset = match line.rfind("] OnPlayerJoined") {
            Some(v) => v,
            None => return true,
        };
        offset += 17;
        if offset >= line.len() {
            return true;
        }
        let display_name = line[offset..].to_string();
        let event = VRCLogEvent {
            time: parse_datetime_from_line(line),
            event: String::from("OnPlayerJoined"),
            data: display_name,
            initial_load,
        };
        let window_guard = TAURI_WINDOW.lock().unwrap();
        let window = window_guard.as_ref().unwrap();
        let _ = window.emit_all("VRC_LOG_EVENT", event.clone());
        if initial_load {
            trace!("[Core] VRC Log Event: {:#?}", event);
        } else {
            debug!("[Core] VRC Log Event: {:#?}", event);
        }
        return true;
    }
    false
}

fn parse_on_player_left(line: String, initial_load: bool) -> bool {
    if line.contains("[Behaviour] OnPlayerLeft")
        && !line.contains("] OnPlayerLeft:")
        && !line.contains("] OnPlayerLeftRoom")
    {
        let mut offset = match line.rfind("] OnPlayerLeft") {
            Some(v) => v,
            None => return true,
        };
        offset += 15;
        if offset >= line.len() {
            return true;
        }
        let display_name = line[offset..].to_string();
        let event = VRCLogEvent {
            time: parse_datetime_from_line(line),
            event: String::from("OnPlayerLeft"),
            data: display_name,
            initial_load,
        };
        let window_guard = TAURI_WINDOW.lock().unwrap();
        let window = window_guard.as_ref().unwrap();
        let _ = window.emit_all("VRC_LOG_EVENT", event.clone());
        if initial_load {
            trace!("[Core] VRC Log Event: {:#?}", event);
        } else {
            debug!("[Core] VRC Log Event: {:#?}", event);
        }
        return true;
    }
    false
}

fn parse_on_location_change(line: String, initial_load: bool) -> bool {
    if line.contains("[Behaviour] Joining ")
        && !line.contains("] Joining or Creating Room: ")
        && !line.contains("] Joining friend: ")
    {
        let mut offset = match line.rfind("] Joining ") {
            Some(v) => v,
            None => return true,
        };
        offset += 10;
        if offset >= line.len() {
            return true;
        }
        let instance_id = line[offset..].to_string();
        let event = VRCLogEvent {
            time: parse_datetime_from_line(line),
            event: String::from("OnLocationChange"),
            data: instance_id,
            initial_load,
        };
        let window_guard = TAURI_WINDOW.lock().unwrap();
        let window = window_guard.as_ref().unwrap();
        let _ = window.emit_all("VRC_LOG_EVENT", event.clone());
        if initial_load {
            trace!("[Core] VRC Log Event: {:?}", event);
        } else {
            debug!("[Core] VRC Log Event: {:?}", event);
        }
        return true;
    }
    false
}

fn watch_log_file(path: String) -> mpsc::Sender<()> {
    let (reader_thread_termination_tx, reader_thread_termination_rx) = mpsc::channel::<()>();
    thread::spawn(move || {
        // Open file stream
        let file = File::open(path.clone()).unwrap();
        let reader = BufReader::new(file);
        let lines = reader.lines();
        let mut lines_iterator = lines.into_iter();
        let mut first_run = true;
        loop {
            if !first_run {
                // Check for new log lines every second
                thread::sleep(Duration::from_secs(1));
            }
            // Check if we have to terminate this reader thread
            let val = reader_thread_termination_rx.try_recv();
            match val {
                Ok(_) | Err(TryRecvError::Disconnected) => {
                    info!("[Core] Log reader thread terminated. ({})", path);
                    break;
                }
                Err(TryRecvError::Empty) => (),
            }
            // Process new lines
            while let Some(line) = lines_iterator.next() {
                let line = line.unwrap();
                if line.trim().is_empty() {
                    continue;
                }
                process_log_line(line, first_run);
            }
            if first_run {
                debug!(
                    "[Core] Initial read of VRChat log file complete. ({})",
                    path
                );
                let window_guard = TAURI_WINDOW.lock().unwrap();
                let window = window_guard.as_ref().unwrap();
                let _ = window.emit_all(
                    "VRC_LOG_EVENT",
                    VRCLogEvent {
                        time: Arc::new(SystemTime::now())
                            .duration_since(UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64,
                        event: String::from("InitialLoadComplete"),
                        data: String::from(""),
                        initial_load: true,
                    },
                );
                first_run = false;
            }
        }
    });
    // Return sender that can be used to terminate reader thread
    reader_thread_termination_tx
}

pub fn spawn_log_parser_thread() -> mpsc::Sender<()> {
    let (parser_thread_termination_tx, parser_thread_termination_rx) = mpsc::channel::<()>();
    thread::spawn(move || {
        struct LoopContext {
            current_log_path: Option<String>,
            reader_thread_termination_tx: Option<mpsc::Sender<()>>,
        }
        let mut loop_context = LoopContext {
            current_log_path: None,
            reader_thread_termination_tx: None,
        };
        let ctx = &mut loop_context;
        loop {
            thread::sleep(Duration::from_millis(1000));
            // Check if we have to terminate this thread
            let val = parser_thread_termination_rx.try_recv();
            match val {
                Ok(_) | Err(TryRecvError::Disconnected) => {
                    // Terminate any reader thread
                    if ctx.reader_thread_termination_tx.is_some() {
                        let _ = ctx.reader_thread_termination_tx.as_ref().unwrap().send(());
                    }
                    // Break to terminate this thread
                    info!("[Core] Terminated VRChat log watcher");
                    break;
                }
                Err(TryRecvError::Empty) => (),
            }
            // Check the current log file path
            let log_path_option = get_latest_log_path();
            if log_path_option.is_none() {
                continue;
            }
            let log_path = log_path_option.unwrap();
            // If we are already watching the current file, stop here
            if ctx.current_log_path.is_some() && *ctx.current_log_path.as_ref().unwrap() == log_path
            {
                continue;
            }
            // We need to watch a new file. Terminate the old reader thread first if it exists.
            if ctx.reader_thread_termination_tx.is_some() {
                let _ = ctx.reader_thread_termination_tx.as_ref().unwrap().send(());
            }
            // Start watching the new file
            info!("[Core] Starting VRChat log watcher. ({})", log_path.clone());
            *ctx = LoopContext {
                current_log_path: Some(log_path.clone()),
                reader_thread_termination_tx: Some(watch_log_file(log_path.clone())),
            };
        }
    });
    // Return sender that can be used to terminate parser thread
    parser_thread_termination_tx
}
