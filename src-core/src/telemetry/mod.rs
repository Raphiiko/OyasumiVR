use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock,
    },
    time::Duration,
};

use log::{info, warn};
use serde_json::{json, Map, Value};
use tokio::sync::Mutex;

use crate::{
    globals::{OPENPANEL_API_URL, OPENPANEL_CLIENT_ID, OPENPANEL_CLIENT_SECRET},
    BUILD_FLAVOUR,
};

pub mod commands;

pub static TELEMETRY_INITIALIZED: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));
pub static TELEMETRY_ENABLED: LazyLock<AtomicBool> = LazyLock::new(|| AtomicBool::new(false));

// OpenPanel treats a bare `name/version` user agent as a server, which records no sessions
static USER_AGENT: LazyLock<String> = LazyLock::new(|| {
    format!(
        "OyasumiVR/{} (Windows NT 10.0; Win64; x64)",
        env!("CARGO_PKG_VERSION")
    )
});

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(USER_AGENT.as_str())
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap()
});

/// Added to every event. OpenPanel reads the `__` keys in place of what it parses from the user agent,
/// and hides them from the property list.
static SYSTEM_PROPERTIES: LazyLock<Map<String, Value>> = LazyLock::new(|| {
    let os = windows_version::OsVersion::current();
    let flavour = serde_json::to_string(&BUILD_FLAVOUR)
        .unwrap()
        .trim_matches('"')
        .to_uppercase();
    let properties = json!({
        "app_version": env!("CARGO_PKG_VERSION"),
        "__os": "Windows",
        "__osVersion": format!("{}.{}.{}", os.major, os.minor, os.build),
        "__browser": "WebView2",
        "__browserVersion": tauri::webview_version().unwrap_or_default(),
        "flavour": flavour,
    });
    let Value::Object(properties) = properties else {
        unreachable!()
    };
    properties
});

/// Sends an event in the background when telemetry is enabled. Failures are logged and dropped.
pub fn track_event(name: &str, props: Option<Map<String, Value>>) {
    if !TELEMETRY_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let mut properties = props.unwrap_or_default();
    properties.extend(SYSTEM_PROPERTIES.clone());
    let body = json!({
        "type": "track",
        "payload": { "name": name, "properties": properties },
    });
    let name = name.to_string();
    tokio::spawn(async move {
        let result = HTTP_CLIENT
            .post(format!("{OPENPANEL_API_URL}/track"))
            .header("openpanel-client-id", OPENPANEL_CLIENT_ID)
            .header("openpanel-client-secret", OPENPANEL_CLIENT_SECRET)
            .json(&body)
            .send()
            .await
            .and_then(|response| response.error_for_status());
        if let Err(e) = result {
            warn!("[Core] Could not send telemetry event {name}: {e}");
        }
    });
}

pub async fn init_telemetry() {
    *TELEMETRY_INITIALIZED.lock().await = true;
    // the server ends a session after 4 hours without events
    tokio::task::spawn(async {
        loop {
            tokio::time::sleep(Duration::from_secs(3600 * 7 / 2)).await;
            track_event("app_heartbeat", None);
        }
    });
    if !TELEMETRY_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    info!("[Core] Initializing telemetry");
    track_event("app_started", None);
}
