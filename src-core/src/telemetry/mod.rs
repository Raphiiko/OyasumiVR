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

// OpenPanel records no device or session for a user agent it cannot parse an OS or browser from
static USER_AGENT: LazyLock<String> = LazyLock::new(|| {
    format!(
        "OyasumiVR/{} ({})",
        env!("CARGO_PKG_VERSION"),
        sysinfo::System::long_os_version().unwrap_or_default()
    )
});

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(USER_AGENT.as_str())
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap()
});

/// Added to every event. OpenPanel reads `__osVersion` in place of the version it parses from the user
/// agent, and hides it from the property list.
static SYSTEM_PROPERTIES: LazyLock<Map<String, Value>> = LazyLock::new(|| {
    let os = windows_version::OsVersion::current();
    let flavour = serde_json::to_string(&BUILD_FLAVOUR)
        .unwrap()
        .trim_matches('"')
        .to_uppercase();
    let properties = json!({
        "app_version": env!("CARGO_PKG_VERSION"),
        "__osVersion": format!("{}.{}.{}", os.major, os.minor, os.build),
        "webview_version": tauri::webview_version().unwrap_or_default(),
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
    let name = name.to_string();
    tokio::spawn(async move {
        // telemetry may be disabled between the check above and this task running
        if !TELEMETRY_ENABLED.load(Ordering::Relaxed) {
            return;
        }
        if let Err(e) = send_event(&name, props).await {
            warn!("[Core] Could not send telemetry event {name}: {e}");
        }
    });
}

/// Sends an event and waits for OpenPanel to accept it. Ignores whether telemetry is enabled.
async fn send_event(name: &str, props: Option<Map<String, Value>>) -> Result<(), String> {
    let mut properties = props.unwrap_or_default();
    properties.extend(SYSTEM_PROPERTIES.clone());
    let body = json!({
        "type": "track",
        "payload": { "name": name, "properties": properties },
    });
    HTTP_CLIENT
        .post(format!("{OPENPANEL_API_URL}/track"))
        .header("openpanel-client-id", OPENPANEL_CLIENT_ID)
        .header("openpanel-client-secret", OPENPANEL_CLIENT_SECRET)
        .json(&body)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Sends `app_quit`, blocking the caller for up to 2 seconds while OpenPanel accepts it.
pub fn track_quit() {
    if !TELEMETRY_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    // the caller can run inside the async runtime, where block_on panics
    let sent = std::thread::spawn(|| {
        tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(2), send_event("app_quit", None)).await
        })
    })
    .join();
    match sent {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(e))) => warn!("[Core] Could not send telemetry event app_quit: {e}"),
        Ok(Err(_)) => warn!("[Core] Could not send telemetry event app_quit: timed out"),
        Err(_) => warn!("[Core] Could not send telemetry event app_quit: the sender panicked"),
    }
}

pub async fn init_telemetry() {
    *TELEMETRY_INITIALIZED.lock().await = true;
    // a session that ends without app_quit reads short by up to this interval
    tokio::task::spawn(async {
        loop {
            tokio::time::sleep(Duration::from_secs(3600)).await;
            track_event("app_heartbeat", None);
        }
    });
    if !TELEMETRY_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    info!("[Core] Initializing telemetry");
    track_event("app_started", None);
}
