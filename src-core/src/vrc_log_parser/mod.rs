pub mod commands;

use crate::utils::send_event;
use chrono::{Local, NaiveDateTime, TimeZone};
use log::{debug, info, trace, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    fs::{read_dir, File},
    io::{BufRead, BufReader},
    os::windows::prelude::MetadataExt,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct VRCLogEvent {
    time: u64,
    event: String,
    data: String,
    initial_load: bool,
}

static MUTE_LOG_DIR_NO_EXIST_WARNINGS: AtomicBool = AtomicBool::new(false);

fn get_latest_log_path() -> Option<String> {
    // Get all files in the log directory
    let home_dir = dirs::home_dir()?;
    let dir = read_dir(home_dir.join("AppData\\LocalLow\\VRChat\\VRChat"));
    // If log directory doesn't exist, return no path
    if dir.is_err() {
        if !MUTE_LOG_DIR_NO_EXIST_WARNINGS.load(Ordering::Relaxed) {
            warn!("[Core] VRChat log directory doesn't exist (yet)");
            MUTE_LOG_DIR_NO_EXIST_WARNINGS.store(true, Ordering::Relaxed);
        }
        return None;
    }
    MUTE_LOG_DIR_NO_EXIST_WARNINGS.store(false, Ordering::Relaxed);
    // Get the latest log file
    dir.ok()?
        .filter_map(|entry| entry.ok())
        // Only get log files
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            name.starts_with("output_log_") && name.ends_with(".txt")
        })
        // Find most recent log file
        .max_by_key(|entry| {
            entry
                .path()
                .metadata()
                .ok()
                .and_then(|m| Some(m.creation_time()))
        })
        // Get the path for it
        .and_then(|entry| entry.path().to_str().map(String::from))
}

fn parse_datetime_from_line(line: String) -> Option<u64> {
    let localtime = NaiveDateTime::parse_from_str(&line[0..19], "%Y.%m.%d %H:%M:%S").unwrap();
    // In the case of a DST rollback, we pick the latest possible time
    // During this hour, the logs will still be parsed in order, but their timestamps will be out of order.
    let time = Local.from_local_datetime(&localtime).latest();
    match time {
        Some(v) => Some(v.timestamp_millis() as u64),
        None => return None,
    }
}

async fn process_log_line(line: String, initial_load: bool) {
    let _ = parse_on_player_joined(line.clone(), initial_load).await
        || parse_on_player_left(line.clone(), initial_load).await
        || parse_on_location_change(line.clone(), initial_load).await;
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
        let time = match parse_datetime_from_line(line) {
            Some(v) => v,
            None => return true,
        };
        let event = VRCLogEvent {
            time: time,
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
        let time = match parse_datetime_from_line(line) {
            Some(v) => v,
            None => return true,
        };
        let event = VRCLogEvent {
            time: time,
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
        let time = match parse_datetime_from_line(line) {
            Some(v) => v,
            None => return true,
        };
        let event = VRCLogEvent {
            time: time,
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

fn start_log_watch_task(path: String) -> CancellationToken {
    let cancellation_token = CancellationToken::new();
    let cancellation_token_internal = cancellation_token.clone();
    tokio::spawn(async move {
        let file = File::open(path.clone()).unwrap();
        let reader = BufReader::new(file);
        let lines = reader.lines();
        let mut lines_iterator = lines;
        let mut first_run = true;

        // Use an async block to make the loop asynchronous
        while !cancellation_token_internal.is_cancelled() {
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
    });
    cancellation_token
}

pub fn start_log_locator_task() -> CancellationToken {
    let cancellation_token = CancellationToken::new();
    let cancellation_token_internal = cancellation_token.clone();
    tokio::spawn(async move {
        struct LoopContext {
            current_log_path: Option<String>,
            reader_task_cancellation_token: Option<CancellationToken>,
        }
        let mut loop_context = LoopContext {
            current_log_path: None,
            reader_task_cancellation_token: None,
        };
        let ctx = &mut loop_context;
        while !cancellation_token_internal.is_cancelled() {
            tokio::time::sleep(Duration::from_millis(1000)).await;
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
            // We need to watch a new file. Terminate the old reader task first if it exists.
            if let Some(token) = &ctx.reader_task_cancellation_token {
                send_event("VRC_LOG_CURRENT_FILE", None::<String>).await;
                token.cancel();
            }
            // Start watching the new file
            info!("[Core] Starting VRChat log watcher. ({})", log_path.clone());
            *ctx = LoopContext {
                current_log_path: Some(log_path.clone()),
                reader_task_cancellation_token: Some(start_log_watch_task(log_path.clone())),
            };
            // Inform the front of the current log path
            send_event("VRC_LOG_CURRENT_FILE", Some(log_path.clone())).await;
        }
        // Terminate any reader task
        if let Some(token) = &ctx.reader_task_cancellation_token {
            token.cancel();
        }
        // Inform the front of the current log path
        send_event("VRC_LOG_CURRENT_FILE", None::<String>).await;
        // Break to terminate this task
        info!("[Core] Terminated VRChat log watcher");
    });
    cancellation_token
}
