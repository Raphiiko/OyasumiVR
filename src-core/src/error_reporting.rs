use oyasumivr_shared::error_reporting::{self, EventBudget, EventBudgetConfig};
use sentry::ClientInitGuard;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::Duration,
};
use tauri::Manager;

static ENABLED: LazyLock<Arc<AtomicBool>> = LazyLock::new(|| Arc::new(AtomicBool::new(false)));
static GUARD: LazyLock<Mutex<Option<ClientInitGuard>>> = LazyLock::new(Default::default);
static UI_BUDGET: LazyLock<Mutex<Option<Arc<EventBudget>>>> = LazyLock::new(Default::default);
static UPDATE_LOCK: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(Default::default);

pub fn set_enabled(app: &tauri::AppHandle, enabled: bool) -> bool {
    let enabled = should_enable(enabled, &crate::BUILD_FLAVOUR);
    if !enabled {
        ENABLED.store(false, Ordering::Relaxed);
        return false;
    }
    let Ok(data_dir) = app.path().app_data_dir() else {
        ENABLED.store(false, Ordering::Relaxed);
        return false;
    };
    let (Ok(mut guard), Ok(mut ui_budget)) = (GUARD.lock(), UI_BUDGET.lock()) else {
        ENABLED.store(false, Ordering::Relaxed);
        return false;
    };
    if guard.is_some() {
        ENABLED.store(true, Ordering::Relaxed);
        return true;
    }
    let core_budget = Arc::new(EventBudget::new(
        data_dir.join("error-reporting-core.json"),
        EventBudgetConfig {
            first_event_cap: 20,
            recurrence_cap: 10,
            issue_cap: 3,
            recurrence_sample_rate: 0.1,
        },
    ));
    *ui_budget = Some(Arc::new(EventBudget::new(
        data_dir.join("error-reporting-ui.json"),
        EventBudgetConfig {
            first_event_cap: 20,
            recurrence_cap: 10,
            issue_cap: 3,
            recurrence_sample_rate: 0.1,
        },
    )));
    *guard = Some(error_reporting::init(
        "core",
        env!("CARGO_PKG_VERSION"),
        core_budget,
        ENABLED.clone(),
    ));
    ENABLED.store(true, Ordering::Relaxed);
    true
}

pub(crate) fn should_enable(enabled: bool, flavour: &crate::flavour::BuildFlavour) -> bool {
    enabled && *flavour != crate::flavour::BuildFlavour::Dev
}

/// Reports the rejected command line and returns the redacted report text.
/// Waits for the send, because the caller exits next.
pub fn report_cli_parse_error(error: &str) -> String {
    let args = std::env::args_os()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned());
    let message = cli_parse_error_message(error, args);
    sentry::capture_message(&message, sentry::Level::Error);
    if let Some(client) = sentry::Hub::current().client() {
        client.flush(Some(Duration::from_secs(2)));
    }
    message
}

fn cli_parse_error_message(error: &str, args: impl Iterator<Item = String>) -> String {
    // each argument is redacted alone, since a path match redacts to the end of its line
    let args: Vec<String> = args
        .map(|arg| error_reporting::sanitize_value(&arg))
        .collect();
    format!(
        "Command line arguments rejected: {args:?}\n{}",
        error_reporting::sanitize_value(error)
    )
}

#[tauri::command]
pub async fn set_error_reporting_enabled(app: tauri::AppHandle, enabled: bool) {
    let _update = UPDATE_LOCK.lock().await;
    let enabled = set_enabled(&app, enabled);
    crate::elevated_sidecar::set_error_reporting_enabled(enabled).await;
    crate::overlay_sidecar::set_error_reporting_enabled(enabled).await;
}

#[tauri::command]
pub fn allow_ui_event(issue: String) -> bool {
    if !ENABLED.load(Ordering::Relaxed) || issue.len() > 2_048 {
        return false;
    }
    UI_BUDGET
        .lock()
        .ok()
        .and_then(|budget| budget.as_ref().map(|budget| budget.allow(&issue)))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flavour::BuildFlavour;

    #[test]
    fn redacts_tokens_and_paths_from_rejected_arguments() {
        let url = "oyasumivr://integration/pulsoid/v1/redirect#access_token=abc123secret&token_type=bearer&state=s1";
        let path = r"C:\Users\John Doe\Desktop\OyasumiVR.lnk";
        let error =
            format!("error: unexpected argument '{url}' found\n\nUsage: OyasumiVR.exe [OPTIONS]");
        let args = [url, path, "--minimized"].map(String::from);
        let message = cli_parse_error_message(&error, args.into_iter());
        assert!(!message.contains("abc123secret"));
        assert!(!message.contains("s1"));
        assert!(!message.contains("John"));
        assert!(message.contains("oyasumivr://integration/pulsoid/v1/redirect#access_"));
        assert!(message.contains("--minimized"));
        assert!(message.contains("unexpected argument"));
    }

    #[test]
    fn allows_reporting_in_steam_debug_builds() {
        assert!(should_enable(true, &BuildFlavour::Steam));
        assert!(!should_enable(true, &BuildFlavour::Dev));
        assert!(!should_enable(false, &BuildFlavour::Steam));
    }
}
