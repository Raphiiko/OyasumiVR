use log::info;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

lazy_static! {
    static ref CANCELLATION_TOKEN: Mutex<Option<CancellationToken>> = Default::default();
}

#[tauri::command]
pub async fn init_vrc_log_watcher() {
    info!("[Core] Initializing VRChat Log Watcher...");
    // Terminate existing task if it exists
    let cancellation_token_guard = CANCELLATION_TOKEN.lock().await;
    let cancellation_token = cancellation_token_guard.as_ref();
    if let Some(t) = cancellation_token {
        t.cancel();
    }
    drop(cancellation_token_guard);
    // Start new locator task
    let cancellation_token = super::start_log_locator_task();
    *CANCELLATION_TOKEN.lock().await = Some(cancellation_token);
}
