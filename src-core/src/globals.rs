use tokio::sync::Mutex;

pub const DOTNET_CORE_VERSION: &str = "7.0.11";
pub const ASPNET_CORE_VERSION: &str = "7.0.11";
pub const CORE_GRPC_DEV_PORT: u16 = 5176;
pub const CORE_HTTP_DEV_PORT: u16 = 5177;
pub const OVERLAY_SIDECAR_GRPC_DEV_PORT: u16 = 5174;
pub const OVERLAY_SIDECAR_GRPC_WEB_DEV_PORT: u16 = 5175;

lazy_static! {
    pub static ref TAURI_APP_HANDLE: Mutex<Option<tauri::AppHandle>> = Default::default();
    pub static ref TAURI_CLI_MATCHES: Mutex<Option<tauri::api::cli::Matches>> = Default::default();
}
