pub mod commands;

use crate::utils::send_event;
use chrono::{Local, NaiveDateTime, TimeZone};
use log::{debug, info, trace, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    collections::HashMap,
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
const RECENT_WRITE: Duration = Duration::from_secs(60);
const LOG_AGE_LIMIT: Duration = Duration::from_secs(24 * 60 * 60);

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

/// A log qualifies on its creation time, or on a write recent enough to mean a session is running.
fn is_current_enough(
    created: Option<SystemTime>,
    modified: Option<SystemTime>,
    now: SystemTime,
) -> bool {
    let elapsed = |time: Option<SystemTime>| time.and_then(|time| now.duration_since(time).ok());
    elapsed(modified).is_some_and(|duration| duration <= RECENT_WRITE)
        || elapsed(created).is_some_and(|duration| duration <= LOG_AGE_LIMIT)
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
            path.metadata().is_ok_and(|metadata| {
                is_current_enough(metadata.created().ok(), metadata.modified().ok(), now)
            })
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
        if held_by_vrchat(attached) {
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
    let localtime = NaiveDateTime::parse_from_str(line.get(0..19)?, "%Y.%m.%d %H:%M:%S").ok()?;
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
        let display_name = match line.get(offset..) {
            Some(v) if !v.is_empty() => v.to_string(),
            _ => return true,
        };
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
        let display_name = match line.get(offset..) {
            Some(v) if !v.is_empty() => v.to_string(),
            _ => return true,
        };
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
        let instance_id = match line.get(offset..) {
            Some(v) if !v.is_empty() => v.to_string(),
            _ => return true,
        };
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

/// Returns the next newline-terminated line, decoded lossily, or `None` at the end of the file.
/// A partial last line stays in `line_buf` until VRChat finishes writing it.
fn read_complete_line(reader: &mut impl BufRead, line_buf: &mut Vec<u8>) -> Option<String> {
    match reader.read_until(b'\n', line_buf) {
        Ok(_) if line_buf.ends_with(b"\n") => {
            let line = String::from_utf8_lossy(line_buf)
                .trim_end_matches(['\r', '\n'])
                .to_string();
            line_buf.clear();
            Some(line)
        }
        Ok(_) => None,
        Err(e) => {
            warn!("[Core] Could not read the VRChat log file: {e}");
            None
        }
    }
}

fn start_log_watch_task(path: String) -> CancellationToken {
    let cancellation_token = CancellationToken::new();
    let cancellation_token_internal = cancellation_token.clone();
    tokio::spawn(async move {
        let file = File::open(path.clone()).unwrap();
        let mut reader = BufReader::new(file);
        let mut line_buf = Vec::new();
        let mut first_run = true;

        // Use an async block to make the loop asynchronous
        while !cancellation_token_internal.is_cancelled() {
            if !first_run {
                // Check for new log lines every second
                tokio::time::sleep(Duration::from_secs(1)).await;
            }

            // Process new lines
            while let Some(line) = read_complete_line(&mut reader, &mut line_buf) {
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
        let mut holder_cache: HashMap<PathBuf, (Vec<u32>, Instant)> = HashMap::new();
        while !cancellation_token_internal.is_cancelled() {
            tokio::time::sleep(Duration::from_millis(1000)).await;
            let vrchat_pids = crate::utils::process_ids("VRChat.exe").await;
            let attached = ctx.current_log_path.clone();
            // the holder check blocks for a few hundred milliseconds
            let (log_path_option, cache) = tokio::task::spawn_blocking(move || {
                let mut cache = holder_cache;
                cache.retain(|_, (_, checked_at)| checked_at.elapsed() < HOLDER_CHECK_INTERVAL);
                let mut held_by_vrchat = |path: &Path| {
                    if vrchat_pids.is_empty() {
                        return false;
                    }
                    // cache the holders themselves, so a holder exiting takes effect at once
                    let holders = match cache.get(path) {
                        Some((holders, _)) => holders.clone(),
                        None => {
                            let holders = crate::utils::processes_holding_file(path);
                            cache.insert(path.to_path_buf(), (holders.clone(), Instant::now()));
                            holders
                        }
                    };
                    holders.iter().any(|pid| vrchat_pids.contains(pid))
                };
                let picked = get_latest_log_path(attached.as_deref(), &mut held_by_vrchat);
                (picked, cache)
            })
            .await
            .unwrap_or_default();
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
    use super::{
        is_current_enough, parse_datetime_from_line, parse_on_player_joined, parse_on_player_left,
        pick_log_path, read_complete_line, VRCLogEvent,
    };
    use chrono::{Local, TimeZone, Utc};
    use std::{
        fs,
        path::Path,
        time::{Duration, SystemTime},
    };
    use tempfile::tempdir;

    #[test]
    fn event_time_is_serialized_in_epoch_milliseconds() {
        let instant = Utc.with_ymd_and_hms(2026, 8, 23, 20, 42, 35).unwrap();
        let line = instant
            .with_timezone(&Local)
            .format("%Y.%m.%d %H:%M:%S")
            .to_string();
        let event = VRCLogEvent {
            time: parse_datetime_from_line(line).unwrap(),
            event: "OnPlayerJoined".to_string(),
            data: "Me (usr_me)".to_string(),
            initial_load: false,
        };
        let payload = serde_json::to_value(event).unwrap();
        assert_eq!(payload["time"], 1_787_517_755_000_u64);
        assert_eq!(payload["initialLoad"], false);
    }

    #[test]
    fn reads_complete_lines_across_split_and_invalid_utf8() {
        let mut line_buf = Vec::new();

        let mut first_write: &[u8] = b"bad \xff byte\r\nJoined \xe3\x81";
        assert_eq!(
            read_complete_line(&mut first_write, &mut line_buf).as_deref(),
            Some("bad \u{fffd} byte")
        );
        assert_eq!(read_complete_line(&mut first_write, &mut line_buf), None);

        let mut second_write: &[u8] = b"\x82\n";
        assert_eq!(
            read_complete_line(&mut second_write, &mut line_buf).as_deref(),
            Some("Joined \u{3042}")
        );
        assert_eq!(read_complete_line(&mut second_write, &mut line_buf), None);
    }

    #[tokio::test]
    async fn skips_event_lines_with_a_replacement_character_at_a_slice_offset() {
        assert_eq!(
            parse_datetime_from_line("2026.10.17 12:34:5\u{fffd} Log".to_string()),
            None
        );
        assert_eq!(parse_datetime_from_line("short".to_string()), None);

        let ts = "2026.10.17 12:34:56 Debug      -  ";
        let joined = format!("{ts}[Behaviour] OnPlayerJoined\u{fffd}Name (usr_a)");
        let left = format!("{ts}[Behaviour] OnPlayerLeft\u{fffd}Name (usr_a)");
        let bad_time = "2026.10.17 12:34:5\u{fffd} Debug - [Behaviour] OnPlayerJoined Name";
        assert!(parse_on_player_joined(joined, false).await);
        assert!(parse_on_player_left(left, false).await);
        assert!(parse_on_player_joined(bad_time.to_string(), false).await);
    }

    fn create_log(
        dir: &Path,
        name: &str,
        contents: &[u8],
        created: SystemTime,
    ) -> (String, SystemTime) {
        let path = dir.join(name);
        fs::write(&path, contents).unwrap();
        filetime_creation::set_file_ctime(
            &path,
            filetime_creation::FileTime::from_system_time(created),
        )
        .unwrap();
        let stored_created = path.metadata().unwrap().created().unwrap();
        (path.to_str().unwrap().to_owned(), stored_created)
    }

    #[test]
    fn picks_logs_by_age_attachment_and_size() {
        let dir = tempdir().unwrap();
        let attached_created = SystemTime::UNIX_EPOCH;
        let (attached, created) =
            create_log(dir.path(), "output_log_old.txt", b"log", attached_created);

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

        let newer_time = attached_created + Duration::from_secs(1);
        let (newer, newer_created) =
            create_log(dir.path(), "output_log_new.txt", b"log", newer_time);
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
        let (_, empty_created) = create_log(
            empty_dir.path(),
            "output_log_empty.txt",
            b"",
            SystemTime::UNIX_EPOCH,
        );
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
        let running_created = SystemTime::UNIX_EPOCH;
        let (running, _) = create_log(
            dir.path(),
            "output_log_running.txt",
            b"log",
            running_created,
        );
        let (closed, closed_created) = create_log(
            dir.path(),
            "output_log_closed.txt",
            b"log",
            running_created + Duration::from_secs(1),
        );
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

    #[test]
    fn drops_a_dead_attachment_even_when_it_is_the_newest_log() {
        let dir = tempdir().unwrap();
        let running_created = SystemTime::UNIX_EPOCH;
        let (running, _) = create_log(
            dir.path(),
            "output_log_running.txt",
            b"log",
            running_created,
        );
        let (closed, closed_created) = create_log(
            dir.path(),
            "output_log_closed.txt",
            b"log",
            running_created + Duration::from_secs(1),
        );
        let running_path = Path::new(&running);

        assert_eq!(
            pick_log_path(
                dir.path(),
                Some(&closed),
                closed_created + Duration::from_secs(1),
                &mut |path| path == running_path,
            ),
            Some(running)
        );
    }

    #[test]
    fn keeps_a_log_that_is_still_being_written_past_the_age_limit() {
        let now = SystemTime::now();
        let day_ago = now - Duration::from_secs(25 * 60 * 60);

        assert!(is_current_enough(
            Some(day_ago),
            Some(now - Duration::from_secs(10)),
            now
        ));
        assert!(!is_current_enough(
            Some(day_ago),
            Some(now - Duration::from_secs(120)),
            now
        ));
        assert!(is_current_enough(
            Some(now - Duration::from_secs(60 * 60)),
            Some(day_ago),
            now
        ));
        assert!(!is_current_enough(None, None, now));
    }
}
