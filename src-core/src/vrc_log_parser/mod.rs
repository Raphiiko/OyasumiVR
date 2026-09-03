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
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
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

const HOLDER_CHECK_INTERVAL: Duration = Duration::from_secs(30);

fn get_latest_log_path(
    attached: Option<&str>,
    held_by_vrchat: &mut dyn FnMut(&Path) -> bool,
) -> Option<String> {
    let home_dir = dirs::home_dir()?;
    let dir = home_dir.join("AppData\\LocalLow\\VRChat\\VRChat");
    if read_dir(&dir).is_err() {
        if !MUTE_LOG_DIR_NO_EXIST_WARNINGS.load(Ordering::Relaxed) {
            warn!("[Core] VRChat log directory doesn't exist (yet)");
            MUTE_LOG_DIR_NO_EXIST_WARNINGS.store(true, Ordering::Relaxed);
        }
        return None;
    }
    MUTE_LOG_DIR_NO_EXIST_WARNINGS.store(false, Ordering::Relaxed);
    pick_log_path(&dir, attached, SystemTime::now(), held_by_vrchat)
}

fn pick_log_path(
    dir: &Path,
    attached: Option<&str>,
    now: SystemTime,
    held_by_vrchat: &mut dyn FnMut(&Path) -> bool,
) -> Option<String> {
    let mut candidates: Vec<PathBuf> = read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            name.starts_with("output_log_") && name.ends_with(".txt")
        })
        .filter(|entry| {
            let path = entry.path();
            if attached.is_some_and(|attached| path == Path::new(attached)) {
                return true;
            }
            path.metadata()
                .ok()
                .and_then(|metadata| {
                    metadata.created().ok().and_then(|created_time| {
                        now.duration_since(created_time)
                            .ok()
                            .map(|duration| duration <= Duration::from_secs(24 * 60 * 60))
                    })
                })
                .unwrap_or(false)
        })
        .filter(|entry| {
            entry
                .path()
                .metadata()
                .ok()
                .map(|metadata| metadata.len() > 0)
                .unwrap_or(false)
        })
        .map(|entry| entry.path())
        .collect();
    candidates.sort_by_key(|path| path.metadata().ok().map(|m| m.creation_time()));
    let newest = candidates.last()?;
    let attached = attached
        .map(Path::new)
        .filter(|attached| candidates.iter().any(|candidate| candidate == attached));
    // keep the attached log while VRChat still holds it open
    if let Some(attached) = attached {
        if attached == newest.as_path() || held_by_vrchat(attached) {
            return attached.to_str().map(String::from);
        }
    }
    // otherwise prefer a log VRChat still holds open
    candidates
        .iter()
        .rev()
        .find(|candidate| held_by_vrchat(candidate))
        .unwrap_or(newest)
        .to_str()
        .map(String::from)
}

fn parse_datetime_from_line(line: String) -> Option<u64> {
    let localtime = NaiveDateTime::parse_from_str(&line[0..19], "%Y.%m.%d %H:%M:%S").unwrap();
    // In the case of a DST rollback, we pick the latest possible time
    // During this hour, the logs will still be parsed in order, but their timestamps will be out of order.
    let time = Local.from_local_datetime(&localtime).latest();
    time.map(|v| v.timestamp_millis() as u64)
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
            time,
            event: String::from("OnPlayerJoined"),
            data: display_name,
            initial_load,
        };
        send_event("VRC_LOG_EVENT", event.clone()).await;
        if initial_load {
            trace!("[Core] VRC Log Event: {event:#?}");
        } else {
            debug!("[Core] VRC Log Event: {event:#?}");
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
            time,
            event: String::from("OnPlayerLeft"),
            data: display_name,
            initial_load,
        };
        send_event("VRC_LOG_EVENT", event.clone()).await;
        if initial_load {
            trace!("[Core] VRC Log Event: {event:#?}");
        } else {
            debug!("[Core] VRC Log Event: {event:#?}");
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
            time,
            event: String::from("OnLocationChange"),
            data: instance_id,
            initial_load,
        };
        send_event("VRC_LOG_EVENT", event.clone()).await;
        if initial_load {
            trace!("[Core] VRC Log Event: {event:?}");
        } else {
            debug!("[Core] VRC Log Event: {event:?}");
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
                debug!("[Core] Initial read of VRChat log file complete. ({path})");
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

        info!("[Core] Log reader task terminated. ({path})");
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
        let mut holder_cache: Option<(PathBuf, bool, Instant)> = None;
        while !cancellation_token_internal.is_cancelled() {
            tokio::time::sleep(Duration::from_millis(1000)).await;
            let vrchat_pids = crate::utils::process_ids("VRChat.exe").await;
            let attached = ctx.current_log_path.clone();
            // the holder check blocks for a few hundred milliseconds
            let (log_path_option, cache) = tokio::task::spawn_blocking(move || {
                let mut cache = holder_cache;
                let mut held_by_vrchat = |path: &Path| {
                    if vrchat_pids.is_empty() {
                        return false;
                    }
                    if let Some((cached, held, checked_at)) = &cache {
                        if cached == path && checked_at.elapsed() < HOLDER_CHECK_INTERVAL {
                            return *held;
                        }
                    }
                    let held = crate::utils::processes_holding_file(path)
                        .iter()
                        .any(|pid| vrchat_pids.contains(pid));
                    cache = Some((path.to_path_buf(), held, Instant::now()));
                    held
                };
                let picked = get_latest_log_path(attached.as_deref(), &mut held_by_vrchat);
                (picked, cache)
            })
            .await
            .unwrap_or((None, None));
            holder_cache = cache;
            if log_path_option.is_none() {
                // If we are currently reading a log file, stop the reader task
                if ctx.current_log_path.is_some() {
                    if let Some(token) = &ctx.reader_task_cancellation_token {
                        send_event("VRC_LOG_CURRENT_FILE", None::<String>).await;
                        token.cancel();
                    }
                    *ctx = LoopContext {
                        current_log_path: None,
                        reader_task_cancellation_token: None,
                    };
                }
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

#[cfg(test)]
mod tests {
    use super::pick_log_path;
    use std::{
        fs,
        path::Path,
        thread,
        time::{Duration, SystemTime},
    };
    use tempfile::tempdir;

    fn create_log(dir: &Path, name: &str, contents: &[u8]) -> (String, SystemTime) {
        let path = dir.join(name);
        fs::write(&path, contents).unwrap();
        let created = path.metadata().unwrap().created().unwrap();
        (path.to_str().unwrap().to_owned(), created)
    }

    #[test]
    fn picks_logs_by_age_attachment_and_size() {
        let dir = tempdir().unwrap();
        let (attached, created) = create_log(dir.path(), "output_log_old.txt", b"log");

        assert_eq!(
            pick_log_path(
                dir.path(),
                None,
                created + Duration::from_secs(23 * 60 * 60),
                &mut |_: &Path| false,
            ),
            Some(attached.clone())
        );
        assert_eq!(
            pick_log_path(
                dir.path(),
                None,
                created + Duration::from_secs(25 * 60 * 60),
                &mut |_: &Path| false,
            ),
            None
        );
        assert_eq!(
            pick_log_path(
                dir.path(),
                Some(&attached),
                created + Duration::from_secs(25 * 60 * 60),
                &mut |_: &Path| false,
            ),
            Some(attached.clone())
        );
        assert_eq!(
            pick_log_path(
                dir.path(),
                Some(dir.path().join("missing.txt").to_str().unwrap()),
                created + Duration::from_secs(25 * 60 * 60),
                &mut |_: &Path| false,
            ),
            None
        );

        thread::sleep(Duration::from_millis(20));
        let (newer, newer_created) = create_log(dir.path(), "output_log_new.txt", b"log");
        assert_eq!(
            pick_log_path(
                dir.path(),
                Some(&attached),
                newer_created + Duration::from_secs(1),
                &mut |_: &Path| false,
            ),
            Some(newer)
        );

        let empty_dir = tempdir().unwrap();
        let (_, empty_created) = create_log(empty_dir.path(), "output_log_empty.txt", b"");
        assert_eq!(
            pick_log_path(
                empty_dir.path(),
                None,
                empty_created + Duration::from_secs(1),
                &mut |_: &Path| false,
            ),
            None
        );
    }

    #[test]
    fn keeps_the_log_a_vrchat_process_still_holds_open() {
        let dir = tempdir().unwrap();
        let (running, _) = create_log(dir.path(), "output_log_running.txt", b"log");
        thread::sleep(Duration::from_millis(20));
        let (closed, closed_created) = create_log(dir.path(), "output_log_closed.txt", b"log");
        let now = closed_created + Duration::from_secs(1);
        let running_path = Path::new(&running);

        assert_eq!(
            pick_log_path(dir.path(), Some(&running), now, &mut |path| path
                == running_path),
            Some(running.clone())
        );
        assert_eq!(
            pick_log_path(dir.path(), Some(&running), now, &mut |_: &Path| false),
            Some(closed.clone())
        );
        assert_eq!(
            pick_log_path(dir.path(), None, now, &mut |path| path == running_path),
            Some(running)
        );
        assert_eq!(
            pick_log_path(dir.path(), None, now, &mut |_: &Path| false),
            Some(closed)
        );
    }
}
