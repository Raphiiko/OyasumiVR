use std::path::Path;

// Present in the content of the Chinese Steam depot only.
const MARKER_FILE: &str = "cn_release";

pub async fn is_cn_release() -> bool {
    if Path::new(MARKER_FILE).exists() {
        return true;
    }
    // The Steamworks interface pointer is only valid once the client has been initialized.
    if crate::steam::STEAMWORKS_CLIENT.lock().await.is_none() {
        return false;
    }
    unsafe {
        let utils = steamworks::sys::SteamAPI_SteamUtils_v010();
        !utils.is_null() && steamworks::sys::SteamAPI_ISteamUtils_IsSteamChinaLauncher(utils)
    }
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn cn_compliance_mode() -> bool {
    is_cn_release().await
}
