use std::sync::LazyLock;
use tauri::AppHandle;
use tauri_plugin_cli::Matches;
use tokio::sync::Mutex;

pub const STEAM_APP_KEY: &str = "steam.overlay.2538150-DEV";
pub const CORE_GRPC_DEV_PORT: u16 = 5176;
pub const CORE_HTTP_DEV_PORT: u16 = 5177;
pub const OVERLAY_SIDECAR_GRPC_DEV_PORT: u16 = 5174;
pub const OVERLAY_SIDECAR_GRPC_WEB_DEV_PORT: u16 = 5175;
pub const OPENPANEL_API_URL: &str = "https://openpanel.raphii.co/api";
pub const OPENPANEL_CLIENT_ID: &str = "277dcfa8-567e-426d-834c-85f0a5a27d52";
pub const OPENPANEL_CLIENT_SECRET: &str = "sec_625fc5edf7c0a054bddc";

pub static TAURI_APP_HANDLE: LazyLock<Mutex<Option<AppHandle>>> = LazyLock::new(Default::default);
pub static TAURI_CLI_MATCHES: LazyLock<Mutex<Option<Matches>>> = LazyLock::new(Default::default);
