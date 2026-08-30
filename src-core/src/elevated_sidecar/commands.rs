use crate::utils::sidecar_manager::StartOutcome;

/// Starts the sidecar and says what the attempt did. On the scheduled task path `Started` means
/// the task was asked to run, which is not the same as the sidecar running.
pub(super) async fn start_sidecar() -> StartOutcome {
    let mut sidecar_manager_guard = super::SIDECAR_MANAGER.lock().await;
    let Some(sidecar_manager) = sidecar_manager_guard.as_mut() else {
        return StartOutcome::Failed;
    };
    sidecar_manager.start().await
}

#[tauri::command]
pub async fn elevated_sidecar_started() -> bool {
    let mut sidecar_manager_guard = super::SIDECAR_MANAGER.lock().await;
    let sidecar_manager = sidecar_manager_guard.as_mut().unwrap();
    sidecar_manager.has_started().await
}

#[tauri::command]
pub async fn elevated_sidecar_get_grpc_web_port() -> Option<u32> {
    let manager_guard = super::SIDECAR_MANAGER.lock().await;
    let manager = manager_guard.as_ref();
    match manager {
        Some(manager) => {
            let grpc_web_port = manager.grpc_web_port.lock().await;
            grpc_web_port.as_ref().map(|grpc_web_port| *grpc_web_port)
        }
        None => None,
    }
}

#[tauri::command]
pub async fn elevated_sidecar_get_grpc_port() -> Option<u32> {
    let manager_guard = super::SIDECAR_MANAGER.lock().await;
    let manager = manager_guard.as_ref();
    match manager {
        Some(manager) => {
            let grpc_port = manager.grpc_port.lock().await;
            grpc_port.as_ref().map(|grpc_port| *grpc_port)
        }
        None => None,
    }
}

/// The one call that can raise a UAC prompt. The result distinguishes a declined prompt from a
/// failure, which the UI reports differently.
#[tauri::command]
pub async fn elevated_features_enable() -> super::launcher::EnableResult {
    super::launcher::enable().await
}

#[tauri::command]
pub async fn elevated_features_disable() -> DisableResult {
    // taken before the manager lock, the same order enable uses
    let _transition = super::TRANSITION.lock().await;
    let launcher_cleanup = super::remove_privileged_launcher().await;
    let handshake_cleanup = super::remove_launcher_handshake();
    super::request_stop().await;
    let mut manager_guard = super::SIDECAR_MANAGER.lock().await;
    if let Some(manager) = manager_guard.as_mut() {
        manager.stop_and_stay_stopped().await;
    }
    drop(manager_guard);
    let installation_must_be_removed = matches!(
        &launcher_cleanup,
        Ok(super::LauncherCleanup::RemoveInstallation)
    );
    let cleanup_errors: Vec<_> = [handshake_cleanup.err(), launcher_cleanup.err()]
        .into_iter()
        .flatten()
        .collect();
    if !cleanup_errors.is_empty() {
        let reason = cleanup_errors.join("; ");
        log::error!("[Core] Could not remove the privileged launcher: {reason}");
        return DisableResult::CleanupFailed { reason };
    }
    if installation_must_be_removed
        && !super::wait_until_privileged_launcher_removed(std::time::Duration::from_secs(5)).await
    {
        let reason = "the cleanup process did not remove the installation directory".to_string();
        log::error!("[Core] Could not remove the privileged launcher: {reason}");
        return DisableResult::CleanupFailed { reason };
    }
    DisableResult::Ok
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum DisableResult {
    Ok,
    CleanupFailed { reason: String },
}

#[cfg(test)]
mod tests {
    use super::DisableResult;

    #[test]
    fn cleanup_failure_matches_the_frontend_contract() {
        assert_eq!(
            serde_json::to_value(DisableResult::CleanupFailed {
                reason: "Task Scheduler refused deletion".to_string(),
            })
            .unwrap(),
            serde_json::json!({
                "result": "cleanupFailed",
                "reason": "Task Scheduler refused deletion",
            })
        );
    }
}
