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
    path::Path,
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

fn get_latest_log_path(attached: Option<&str>) -> Option<String> {
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
    pick_log_path(&dir, attached, SystemTime::now())
}

/// Pick the VRChat log file OyasumiVR should follow right now.
///
/// Eligible files are non-empty `output_log_*.txt` entries in `dir` whose
/// last-write time is within the last 24 hours, OR the file currently
/// passed as `attached` (which bypasses the age check so a live watcher
/// does not drop its file once it crosses the 24h mark mid-session).
/// Among the eligible set, the file with the newest last-write time wins.
/// `now` is injected so tests can drive the age filter deterministically.
fn pick_log_path(dir: &Path, attached: Option<&str>, now: SystemTime) -> Option<String> {
    read_dir(dir)
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
                    metadata.modified().ok().and_then(|modified_time| {
                        now.duration_since(modified_time)
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
        // Find the log file currently being written to. Preferring last-write-time over
        // creation-time ensures we follow the running VRChat instance even after a previously
        // launched client has been closed — VRChat does not delete its log file on exit, so
        // the newest by creation-time would otherwise be a stale log of a closed instance.
        .max_by_key(|entry| entry.path().metadata().ok().map(|m| m.last_write_time()))
        .and_then(|entry| entry.path().to_str().map(String::from))
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
        while !cancellation_token_internal.is_cancelled() {
            tokio::time::sleep(Duration::from_millis(1000)).await;
            let log_path_option = get_latest_log_path(ctx.current_log_path.as_deref());
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

    /// `pick_log_path` should respect the 24-hour age window, allow the
    /// currently-attached file to bypass it, ignore zero-byte files, and
    /// prefer a newer file over the attached one when both exist.
    #[test]
    fn picks_logs_by_age_attachment_and_size() {
        let dir = tempdir().unwrap();
        let (attached, created) = create_log(dir.path(), "output_log_old.txt", b"log");

        assert_eq!(
            pick_log_path(
                dir.path(),
                None,
                created + Duration::from_secs(23 * 60 * 60)
            ),
            Some(attached.clone())
        );
        assert_eq!(
            pick_log_path(
                dir.path(),
                None,
                created + Duration::from_secs(25 * 60 * 60)
            ),
            None
        );
        assert_eq!(
            pick_log_path(
                dir.path(),
                Some(&attached),
                created + Duration::from_secs(25 * 60 * 60),
            ),
            Some(attached.clone())
        );
        assert_eq!(
            pick_log_path(
                dir.path(),
                Some(dir.path().join("missing.txt").to_str().unwrap()),
                created + Duration::from_secs(25 * 60 * 60),
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
            ),
            None
        );
    }

    /// Regression for issue #275: when more than one VRChat instance has been run on
    /// the same machine, VRChat leaves the closed instance's log file on disk. Selecting
    /// by creation-time caused OyasumiVR to latch onto the newest-by-creation log, which
    /// could be the closed instance's log instead of the running one. We must select by
    /// last-write-time instead, so the actively-written log of the running instance wins.
    #[test]
    fn prefers_actively_written_log_over_newer_but_stale_log() {
        // Regression test for issue #275: when more than one VRChat instance has been run on
        // the same machine, VRChat leaves the closed instance's log file on disk. Selecting
        // by creation-time caused OyasumiVR to latch onto the newest-by-creation log, which
        // could be the closed instance's log instead of the running one. We must select by
        // last-write-time instead, so the actively-written log of the running instance wins.
        let dir = tempdir().unwrap();
        let (active, active_created) = create_log(dir.path(), "output_log_active.txt", b"hi");

        thread::sleep(Duration::from_millis(20));
        let (_newer, newer_created) = create_log(dir.path(), "output_log_newer.txt", b"hi");

        // Touch the older file so its last-write-time is now strictly newer than the newer
        // file's creation- and last-write-time, mimicking the running instance appending to
        // its log after a previous instance's log has been left on disk.
        thread::sleep(Duration::from_millis(20));
        let active_path = dir.path().join("output_log_active.txt");
        fs::write(&active_path, b"hi\nmore").unwrap();
        let active_modified = active_path.metadata().unwrap().modified().unwrap();

        // Sanity check: the older file's creation-time is earlier than the newer file's,
        // and the older file's last-write-time is later than the newer file's last-write-time.
        assert!(active_created < newer_created);
        assert!(active_modified > newer_created);

        assert_eq!(
            pick_log_path(
                dir.path(),
                None,
                active_modified + Duration::from_secs(60),
            ),
            Some(active)
        );
    }

    /// Regression for the 24-hour age filter: a VRChat session that has been
    /// running for more than 24 hours creates a log whose `created()` timestamp
    /// is well outside the 24-hour window, but it is still being appended to and
    /// must remain a candidate. The age filter is keyed on `modified()` so this
    /// file is selected even when its creation time is older than the cutoff.
    #[test]
    fn keeps_log_eligible_while_actively_written_past_24_hours() {
        let dir = tempdir().unwrap();
        let (path, created) = create_log(dir.path(), "output_log_long_running.txt", b"hi");
        let created_path = dir.path().join("output_log_long_running.txt");

        // Backdate the file's last-write time to 23h after creation. The file's
        // creation time is "now" (just created in this test), but we want to
        // simulate "this log file is from an instance that has been running for
        // 23h" so the 24h age filter is exercised on modified-time, not
        // creation-time. `File::set_modified` is stable cross-platform since 1.75.
        let modified_at = created + Duration::from_secs(23 * 3600);
        let file = fs::OpenOptions::new().write(true).open(&created_path).unwrap();
        file.set_modified(modified_at).unwrap();
        drop(file);

        // Sanity: modified-time is backdated by 23h, so it is within the 24h
        // window from `now`, but creation-time is `now`, which is >24h old.
        let observed_modified = created_path.metadata().unwrap().modified().unwrap();
        assert_eq!(observed_modified, modified_at);

        // `now` is set 24h + 30s after the file was actually created — past
        // the 24h window for creation-time but well within the 24h window for
        // the backdated modified-time.
        let now = created + Duration::from_secs(24 * 3600 + 30);

        assert_eq!(pick_log_path(dir.path(), None, now), Some(path));
    }
}
