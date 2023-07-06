use tokio::sync::Mutex;

lazy_static! {
    pub static ref TAURI_APP_HANDLE: Mutex<Option<tauri::AppHandle>> = Default::default();
    pub static ref TAURI_CLI_MATCHES: Mutex<Option<tauri::api::cli::Matches>> = Default::default();
}
