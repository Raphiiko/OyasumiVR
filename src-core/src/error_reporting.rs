use oyasumivr_shared::error_reporting::{self, EventBudget, EventBudgetConfig};
use sentry::ClientInitGuard;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, LazyLock, Mutex,
};
use tauri::Manager;

static ENABLED: LazyLock<Arc<AtomicBool>> = LazyLock::new(|| Arc::new(AtomicBool::new(false)));
static GUARD: LazyLock<Mutex<Option<ClientInitGuard>>> = LazyLock::new(Default::default);
static UI_BUDGET: LazyLock<Mutex<Option<Arc<EventBudget>>>> = LazyLock::new(Default::default);
static UPDATE_LOCK: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(Default::default);

pub fn set_enabled(app: &tauri::AppHandle, enabled: bool) -> bool {
    let enabled = enabled
        && !cfg!(debug_assertions)
        && crate::BUILD_FLAVOUR != crate::flavour::BuildFlavour::Dev;
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
