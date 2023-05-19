pub mod commands;

use crate::utils::send_event;
use chrono::{Local, NaiveDateTime, TimeZone};
use log::{debug, info, trace, warn};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{BufRead, BufReader},
    os::windows::prelude::MetadataExt,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::api::path::home_dir;
use tokio_util::sync::CancellationToken;

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

async fn process_log_line(line: String, initial_load: bool) {
    if parse_on_player_joined(line.clone(), initial_load.clone()).await {
        return;
    }
    if parse_on_player_left(line.clone(), initial_load.clone()).await {
        return;
    }
    if parse_on_location_change(line.clone(), initial_load.clone()).await {
        return;
    }
}

async fn parse_on_player_joined(line: String, initial_load: bool) -> bool {
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
        send_event("VRC_LOG_EVENT", event.clone()).await;
        if initial_load {
            trace!("[Core] VRC Log Event: {:#?}", event);
        } else {
            debug!("[Core] VRC Log Event: {:#?}", event);
        }
        return true;
    }
    false
}

async fn parse_on_player_left(line: String, initial_load: bool) -> bool {
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
        send_event("VRC_LOG_EVENT", event.clone()).await;
        if initial_load {
            trace!("[Core] VRC Log Event: {:#?}", event);
        } else {
            debug!("[Core] VRC Log Event: {:#?}", event);
        }
        return true;
    }
    false
}

async fn parse_on_location_change(line: String, initial_load: bool) -> bool {
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
        send_event("VRC_LOG_EVENT", event.clone()).await;
        if initial_load {
            trace!("[Core] VRC Log Event: {:?}", event);
        } else {
            debug!("[Core] VRC Log Event: {:?}", event);
        }
        return true;
    }
    false
}

async fn log_watch_task(path: String, cancellation_token: CancellationToken) {
    let file = File::open(path.clone()).unwrap();
    let reader = BufReader::new(file);
    let lines = reader.lines();
    let mut lines_iterator = lines;
    let mut first_run = true;

    // Use an async block to make the loop asynchronous
    while !cancellation_token.is_cancelled() {
        if !first_run {
            // Check for new log lines every second
            tokio::time::sleep(Duration::from_secs(1)).await;
        }

        // Process new lines
        for line in lines_iterator.by_ref() {
            let line = line.unwrap();
            if line.trim().is_empty() {
                continue;
            }
            process_log_line(line, first_run).await;
        }

        if first_run {
            debug!(
                "[Core] Initial read of VRChat log file complete. ({})",
                path
            );
            send_event(
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
            )
            .await;
            first_run = false;
        }
    }

    info!("[Core] Log reader task terminated. ({})", path);
}

fn start_log_watch_task(path: String) -> CancellationToken {
    let cancellation_token = CancellationToken::new();
    tokio::spawn(log_watch_task(path, cancellation_token.clone()));
    cancellation_token
}

async fn log_locator_task(cancellation_token: CancellationToken) {
    struct LoopContext {
        current_log_path: Option<String>,
        reader_task_cancellation_token: Option<CancellationToken>,
    }
    let mut loop_context = LoopContext {
        current_log_path: None,
        reader_task_cancellation_token: None,
    };
    let ctx = &mut loop_context;
    loop {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        // Check if we have to terminate this task
        if cancellation_token.is_cancelled() {
            // Terminate any reader task
            if let Some(token) = &ctx.reader_task_cancellation_token {
                token.cancel();
            }
            // Break to terminate this task
            info!("[Core] Terminated VRChat log watcher");
            break;
        }
        // Check the current log file path
        let log_path_option = get_latest_log_path();
        if log_path_option.is_none() {
            continue;
        }
        let log_path = log_path_option.unwrap();
        // If we are already watching the current file, stop here
        if ctx.current_log_path.is_some() && *ctx.current_log_path.as_ref().unwrap() == log_path {
            continue;
        }
        // We need to watch a new file. Terminate the old reader task first if it exists.
        if let Some(token) = &ctx.reader_task_cancellation_token {
            token.cancel();
        }
        // Start watching the new file
        info!("[Core] Starting VRChat log watcher. ({})", log_path.clone());
        *ctx = LoopContext {
            current_log_path: Some(log_path.clone()),
            reader_task_cancellation_token: Some(start_log_watch_task(log_path.clone())),
        };
    }
}

pub fn start_log_locator_task() -> CancellationToken {
    let cancellation_token = CancellationToken::new();
    tokio::spawn(log_locator_task(cancellation_token.clone()));
    cancellation_token
}
