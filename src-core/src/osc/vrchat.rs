use std::{sync::LazyLock, time::Duration};

use chrono::{DateTime, Utc};
use tokio::sync::Mutex;

use crate::Models::overlay_sidecar::MicrophoneActivityMode;

const VOICE_ACTIVITY_TIMEOUT: u64 = 1000;

static VOICE_ACTIVE: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));
static VOICE_LAST_VALUE: LazyLock<Mutex<f32>> = LazyLock::new(|| Mutex::new(0.0));
static VOICE_LAST_ACTIVE: LazyLock<Mutex<DateTime<Utc>>> = LazyLock::new(|| Mutex::new(Utc::now()));

async fn process_voice_parameter(value: Option<f32>) {
    let value = match value {
        Some(v) => v,
        None => return,
    };
    let mut voice_active = VOICE_ACTIVE.lock().await;
    let mut voice_last_value = VOICE_LAST_VALUE.lock().await;
    let mut voice_last_active = VOICE_LAST_ACTIVE.lock().await;
    if value > 0.0 {
        if !*voice_active {
            on_voice_activity_changed(true).await;
        }
        *voice_active = true;
        *voice_last_active = Utc::now();
        *voice_last_value = value;
    } else if *voice_last_value != 0.0 {
        *voice_last_value = 0.0;
        tokio::spawn(async {
            tokio::time::sleep(Duration::from_millis(VOICE_ACTIVITY_TIMEOUT)).await;
            let mut voice_active = VOICE_ACTIVE.lock().await;
            let voice_last_active = VOICE_LAST_ACTIVE.lock().await;
            let timed_out = (Utc::now() - *voice_last_active).num_milliseconds()
                >= (VOICE_ACTIVITY_TIMEOUT as i64);
            if *voice_active && timed_out {
                on_voice_activity_changed(false).await;
                *voice_active = false;
            }
        });
    }
}

pub async fn process_event(msg: rosc::OscMessage) {
    if msg.addr.as_str() == "/avatar/parameters/Voice" {
        let value = msg.args[0].clone();
        process_voice_parameter(value.float()).await;
    };
}

async fn on_voice_activity_changed(state: bool) {
    crate::overlay_sidecar::set_microphone_active(state, MicrophoneActivityMode::VrChat).await;
}
