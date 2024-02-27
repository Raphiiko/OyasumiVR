use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
};

use log::{info, warn};
// use serde_json::json;
// use tauri_plugin_aptabase::EventTracker;
use tokio::sync::Mutex;

// use crate::{flavour::BuildFlavour, BUILD_FLAVOUR};

struct CommandInvocation {
    pub name: String,
    pub time: u128,
}

lazy_static! {
    static ref INVOCATION_COUNT: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
    static ref INVOCATION_TIMES: Mutex<HashMap<String, CommandInvocation>> =
        Mutex::new(HashMap::new());
    static ref PROFILING_ENABLED: AtomicBool = AtomicBool::new(false);
    static ref EVENT_COUNTER: Mutex<HashMap<String, u128>> = Mutex::new(HashMap::new());
}

pub fn enable_profiling() {
    info!("[Core] [PROFILING] Profiling enabled!");
    PROFILING_ENABLED.store(true, Ordering::Relaxed);
    tokio::task::spawn(async {
        loop {
            if !PROFILING_ENABLED.load(Ordering::Relaxed) {
                break;
            }
            detect_dead_invocations().await;
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        }
    });
}

// pub fn disable_profiling() {
//     PROFILING_ENABLED.store(false, Ordering::Relaxed);
// }

pub async fn register_event(name: &str) {
    if !PROFILING_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let mut event_counter_guard = EVENT_COUNTER.lock().await;
    let event_counter = &mut *event_counter_guard;
    let count = event_counter.entry(name.to_string()).or_insert(0);
    *count += 1;
    // println!("EVENT EMITTED: {} (COUNT: {})", name, count);
}

pub async fn profile_command_start(name: &str) -> Option<String> {
    if !PROFILING_ENABLED.load(Ordering::Relaxed) {
        return None;
    }
    let name: String = name.to_string();
    // Generate random invocation ID
    let invocation_id = uuid::Uuid::new_v4().to_string();
    let invocation_id_inner = invocation_id.clone();
    let time = super::get_time();
    // Store invocation time
    {
        let mut invocation_times_guard = INVOCATION_TIMES.lock().await;
        let invocation_times = &mut *invocation_times_guard;
        invocation_times.insert(
            invocation_id_inner.clone(),
            CommandInvocation {
                name: name.clone(),
                time,
            },
        );
    }
    // Increase count for name
    {
        let mut invocation_count_guard = INVOCATION_COUNT.lock().await;
        let invocation_count = &mut *invocation_count_guard;
        let count = invocation_count.entry(name.clone()).or_insert(0);
        *count += 1;
        println!("COMMAND CALLED: {} (COUNT: {})", name, count);
    }
    Some(invocation_id)
}

pub fn profile_command_finish(invocation_id: Option<String>) {
    if invocation_id.is_none() || !PROFILING_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let invocation_id = invocation_id.unwrap();
    let time = super::get_time();
    tokio::task::spawn(async move {
        // Get invocation time
        let invocation = {
            let mut invocation_times_guard = INVOCATION_TIMES.lock().await;
            let invocation_times = &mut *invocation_times_guard;
            invocation_times.remove(&invocation_id)
        };
        if invocation.is_none() {
            return;
        }
        let invocation = invocation.unwrap();
        // Calculate duration
        let duration = time - invocation.time;
        // Process duration
        // println!("COMMAND FINISHED: {}", invocation.name);
        if duration >= 1000 {
            warn!(
                "[Core] [PROFILING] Invocation of '{}' command finished, but took {}ms!",
                invocation.name, duration
            );
            // if BUILD_FLAVOUR != BuildFlavour::Dev {
            //     let handle = crate::globals::TAURI_APP_HANDLE.lock().await;
            //     if let Some(handle) = handle.as_ref() {
            //         handle.track_event(
            //             "command_profiling_excessive_duration",
            //             Some(json!({
            //               "command": invocation.name,
            //               "duration": duration,
            //             })),
            //         );
            //     }
            // }
        }
    });
}

async fn detect_dead_invocations() {
    let time = super::get_time();
    let mut dead_invocations: Vec<(String, String, u128)> = Vec::new();
    let mut invocation_times_guard = INVOCATION_TIMES.lock().await;
    {
        let invocation_times = &mut *invocation_times_guard;
        for (invocation_id, invocation) in invocation_times.iter() {
            let duration = time - invocation.time;
            if duration >= 5000 {
                dead_invocations.push((invocation_id.clone(), invocation.name.clone(), duration));
            }
        }
    }
    for (invocation_id, command_name, duration) in dead_invocations {
        // Remove invocation
        {
            let invocation_times = &mut *invocation_times_guard;
            invocation_times.remove(&invocation_id);
        }
        // Log warning
        warn!(
            "[Core] [PROFILING] Invocation of '{}' command is taking too long ({}ms)!",
            command_name, duration
        );
        // if BUILD_FLAVOUR != BuildFlavour::Dev {
        //     let handle = crate::globals::TAURI_APP_HANDLE.lock().await;
        //     if let Some(handle) = handle.as_ref() {
        //         handle.track_event(
        //             "command_profiling_timeout",
        //             Some(json!({
        //               "command": command_name,
        //             })),
        //         );
        //     }
        // }
    }
}
