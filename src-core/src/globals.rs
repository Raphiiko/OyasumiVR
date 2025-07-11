use config::Config;
use std::sync::LazyLock;
use tauri::AppHandle;
use tauri_plugin_cli::Matches;
use tokio::sync::Mutex;

pub const STEAM_APP_KEY: &str = "steam.overlay.2538150-DEV";
pub const CORE_GRPC_DEV_PORT: u16 = 5176;
pub const CORE_HTTP_DEV_PORT: u16 = 5177;
pub const OVERLAY_SIDECAR_GRPC_DEV_PORT: u16 = 5174;
pub const OVERLAY_SIDECAR_GRPC_WEB_DEV_PORT: u16 = 5175;
pub const APTABASE_APP_KEY: &str = "A-SH-8039967080";
pub const APTABASE_HOST: &str = "https://aptabase.raphii.co";

pub static TAURI_APP_HANDLE: LazyLock<Mutex<Option<AppHandle>>> = LazyLock::new(Default::default);
pub static TAURI_CLI_MATCHES: LazyLock<Mutex<Option<Matches>>> = LazyLock::new(Default::default);
pub static FLAGS: LazyLock<Mutex<Option<Config>>> = LazyLock::new(Default::default);

#[allow(dead_code)]
pub async fn is_flag_set(flag: &str) -> bool {
    let flags = FLAGS.lock().await;
    if let Some(flags) = flags.as_ref() {
        return flags.get_bool(flag).unwrap_or(false);
    }
    false
}
