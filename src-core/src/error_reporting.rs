use oyasumivr_shared::error_reporting::{self, EventBudget};
use sentry::{ClientInitGuard, Level};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

static ENABLED: LazyLock<Arc<AtomicBool>> = LazyLock::new(|| Arc::new(AtomicBool::new(false)));
static GUARD: LazyLock<Mutex<Option<ClientInitGuard>>> = LazyLock::new(Default::default);
static UI_BUDGET: LazyLock<Mutex<Option<Arc<EventBudget>>>> = LazyLock::new(Default::default);
static OVERLAY_BUDGET: LazyLock<Mutex<Option<Arc<EventBudget>>>> = LazyLock::new(Default::default);

pub fn set_enabled(app: &tauri::AppHandle, enabled: bool) {
    let enabled = enabled
        && !cfg!(debug_assertions)
        && crate::BUILD_FLAVOUR != crate::flavour::BuildFlavour::Dev;
    ENABLED.store(enabled, Ordering::Relaxed);
    if !enabled {
        return;
    }
    let Ok(data_dir) = app.path().app_data_dir() else {
        ENABLED.store(false, Ordering::Relaxed);
        return;
    };
    let (Ok(mut guard), Ok(mut ui_budget), Ok(mut overlay_budget)) =
        (GUARD.lock(), UI_BUDGET.lock(), OVERLAY_BUDGET.lock())
    else {
        ENABLED.store(false, Ordering::Relaxed);
        return;
    };
    if guard.is_some() {
        return;
    }
    let core_budget = Arc::new(EventBudget::new(
        data_dir.join("error-reporting-core.json"),
        20,
        4,
    ));
    *ui_budget = Some(Arc::new(EventBudget::new(
        data_dir.join("error-reporting-ui.json"),
        20,
        4,
    )));
    *overlay_budget = Some(Arc::new(EventBudget::new(
        data_dir.join("error-reporting-overlay.json"),
        6,
        2,
    )));
    *guard = Some(error_reporting::init(
        "core",
        env!("CARGO_PKG_VERSION"),
        core_budget,
        0.5,
        ENABLED.clone(),
    ));
}

#[tauri::command]
pub fn allow_ui_event(issue: String) -> bool {
    if !ENABLED.load(Ordering::Relaxed) || issue.len() > 512 {
        return false;
    }
    UI_BUDGET
        .lock()
        .ok()
        .and_then(|budget| budget.as_ref().map(|budget| budget.allow(&issue)))
        .unwrap_or(false)
}

pub fn capture_overlay_exit() {
    if !ENABLED.load(Ordering::Relaxed) || !sample_overlay_exit() {
        return;
    }
    let allowed = OVERLAY_BUDGET
        .lock()
        .ok()
        .and_then(|budget| {
            budget
                .as_ref()
                .map(|budget| budget.allow("unexpected-exit"))
        })
        .unwrap_or(false);
    if !allowed {
        return;
    }
    sentry::with_scope(
        |scope| scope.set_tag("component", "overlay"),
        || sentry::capture_message("overlay sidecar exited unexpectedly", Level::Error),
    );
}

fn sample_overlay_exit() -> bool {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos()
        .is_multiple_of(10)
}
