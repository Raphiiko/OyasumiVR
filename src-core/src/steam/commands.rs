#[tauri::command]
#[oyasumivr_macros::command_profiling_async]
pub async fn steam_active() -> bool {
    crate::steam::STEAMWORKS_CLIENT.lock().await.is_some()
}

#[tauri::command]
#[oyasumivr_macros::command_profiling_async]
pub async fn steam_achievement_get(achievement_id: String) -> Result<bool, String> {
    let mut client_guard = crate::steam::STEAMWORKS_CLIENT.lock().await;
    let client = match client_guard.as_mut() {
        Some(client) => client,
        None => return Err("CLIENT_NOT_INITIALIZED".to_string()),
    };
    let stats = client.user_stats();
    let achievement = stats.achievement(achievement_id.as_str());
    match achievement.get() {
        Ok(status) => Ok(status),
        Err(_) => return Err("FAILED_TO_GET_STATUS".to_string()),
    }
}

#[tauri::command]
#[oyasumivr_macros::command_profiling_async]
pub async fn steam_achievement_set(achievement_id: String, unlocked: bool) -> Result<(), String> {
    let mut client_guard = crate::steam::STEAMWORKS_CLIENT.lock().await;
    let client = match client_guard.as_mut() {
        Some(client) => client,
        None => return Err("CLIENT_NOT_INITIALIZED".to_string()),
    };
    let stats = client.user_stats();
    let achievement = stats.achievement(achievement_id.as_str());
    let status = match achievement.get() {
        Ok(status) => status,
        Err(_) => return Err("FAILED_TO_GET_STATUS".to_string()),
    };
    if status == unlocked {
        return Ok(());
    }
    if unlocked {
        if let Err(_) = achievement.set() {
            return Err("FAILED_TO_SET_STATUS".to_string());
        }
    } else {
        if let Err(_) = achievement.clear() {
            return Err("FAILED_TO_SET_STATUS".to_string());
        }
    }
    match stats.store_stats() {
        Ok(_) => Ok(()),
        Err(_) => return Err("FAILED_TO_STORE_STATS".to_string()),
    }
}
