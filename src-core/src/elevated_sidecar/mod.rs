pub mod commands;
pub mod elevate;
pub mod launcher;

use crate::utils::sidecar_manager::{SidecarLaunch, SidecarManager};
use crate::{
    utils::send_event,
    Models::elevated_sidecar::oyasumi_elevated_sidecar_client::OyasumiElevatedSidecarClient,
    Models::oyasumi_core::ElevatedSidecarStartArgs,
};
use log::{info, warn};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    LazyLock,
};
use std::time::Duration;
use tokio::sync::Mutex;
use tonic::transport::Channel;

pub static SIDECAR_GRPC_CLIENT: LazyLock<Mutex<Option<OyasumiElevatedSidecarClient<Channel>>>> =
    LazyLock::new(Default::default);
static SIDECAR_MANAGER: LazyLock<Mutex<Option<SidecarManager>>> = LazyLock::new(Default::default);
static ERROR_REPORTING_ENABLED: AtomicBool = AtomicBool::new(false);
/// Held across a whole enable or disable. Without it the automatic enable at startup and a user
/// toggling the setting can both reach the installer, which costs a second UAC prompt, and a
/// disable can land inside an enable and leave a sidecar running with the setting off.
pub(super) static TRANSITION: LazyLock<Mutex<()>> = LazyLock::new(Default::default);

pub async fn init() {
    let (tx, mut rx) = tokio::sync::mpsc::channel(10);
    // must be chosen here: the start command runs after init and would not see a later decision
    let launch = choose_launch_strategy();
    info!("[Core] Elevated sidecar launch strategy: {launch:?}");
    *SIDECAR_MANAGER.lock().await = Some(SidecarManager::new(
        "ELEVATED".to_string(),
        "resources/elevated-sidecar/".to_string(),
        "oyasumivr-elevated-sidecar.exe".to_string(),
        tx,
        false,
        vec![],
        launch,
    ));
    // Wait for sidecar stop signals
    tokio::spawn(async move {
        while (rx.recv().await).is_some() {
            *SIDECAR_GRPC_CLIENT.lock().await = None;
            send_event("ELEVATED_SIDECAR_STOPPED", ()).await;
        }
    });
}

/// A debug build never installs a prompt-free privileged task, and an elevated core needs none.
fn choose_launch_strategy() -> SidecarLaunch {
    // the child inherits the elevated token
    if oyasumivr_shared::windows::is_elevated() {
        return SidecarLaunch::Spawn;
    }
    // the flavour decides, not debug_assertions: `build:steam:beta` builds with them enabled
    if crate::BUILD_FLAVOUR == crate::flavour::BuildFlavour::Dev {
        return SidecarLaunch::ElevatedSpawn;
    }
    // an account with no elevated token gets NotSupported from launcher::state instead
    SidecarLaunch::ScheduledTask
}

/// Waits for the sidecar to report in, releasing the manager lock between polls so the start
/// signal can be handled.
pub async fn wait_until_started(timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if commands::elevated_sidecar_started().await {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Whether the elevated sidecar goes through the privileged launcher's scheduled task.
pub async fn uses_scheduled_task() -> bool {
    let manager_guard = SIDECAR_MANAGER.lock().await;
    manager_guard
        .as_ref()
        .map(|m| m.launch == SidecarLaunch::ScheduledTask)
        .unwrap_or(false)
}

pub async fn set_error_reporting_enabled(enabled: bool) {
    let enabled = enabled
        && !cfg!(debug_assertions)
        && crate::BUILD_FLAVOUR != crate::flavour::BuildFlavour::Dev;
    ERROR_REPORTING_ENABLED.store(enabled, Ordering::Relaxed);
    let mut manager_guard = SIDECAR_MANAGER.lock().await;
    let Some(manager) = manager_guard.as_mut() else {
        return;
    };
    // only reaches the paths that pass arguments; elsewhere the gRPC push below does it
    manager
        .set_arg("--error-reporting-enabled", enabled, true)
        .await;
    drop(manager_guard);
    let client = SIDECAR_GRPC_CLIENT.lock().await.clone();
    if let Some(mut client) = client {
        for attempt in 0..3 {
            let result = tokio::time::timeout(
                Duration::from_millis(500),
                client.set_error_reporting_enabled(tonic::Request::new(
                    crate::Models::elevated_sidecar::SetErrorReportingEnabledRequest { enabled },
                )),
            )
            .await;
            if matches!(result, Ok(Ok(_))) {
                return;
            }
            if attempt < 2 {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
        if enabled {
            warn!("[Core] Failed to enable elevated sidecar error reporting");
            return;
        }
        warn!("[Core] Failed to disable elevated sidecar error reporting; stopping it");
        let stopped = matches!(
            tokio::time::timeout(
                Duration::from_millis(500),
                client.request_stop(tonic::Request::new(
                    crate::Models::elevated_sidecar::Empty {},
                )),
            )
            .await,
            Ok(Ok(_))
        );
        if !stopped {
            retry_disabled_consent();
        }
    }
}

fn retry_disabled_consent() {
    tokio::spawn(async {
        for _ in 0..30 {
            if ERROR_REPORTING_ENABLED.load(Ordering::Relaxed) {
                return;
            }
            let client = SIDECAR_GRPC_CLIENT.lock().await.clone();
            if let Some(mut client) = client {
                let result = tokio::time::timeout(
                    Duration::from_millis(500),
                    client.set_error_reporting_enabled(tonic::Request::new(
                        crate::Models::elevated_sidecar::SetErrorReportingEnabledRequest {
                            enabled: false,
                        },
                    )),
                )
                .await;
                if matches!(result, Ok(Ok(_))) {
                    return;
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        warn!("[Core] Elevated sidecar did not acknowledge disabled error reporting consent");
    });
}

pub async fn request_stop() {
    let client = SIDECAR_GRPC_CLIENT.lock().await.clone();
    let Some(mut client) = client else {
        return;
    };
    info!("[Core] Stopping current sidecar...");
    let stopped = matches!(
        tokio::time::timeout(
            Duration::from_secs(2),
            client.request_stop(tonic::Request::new(
                crate::Models::elevated_sidecar::Empty {},
            )),
        )
        .await,
        Ok(Ok(_))
    );
    if !stopped {
        warn!("[Core] The elevated sidecar did not acknowledge the stop request");
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LauncherCleanup {
    RemoveInstallation,
    RetainInstallation,
    AlreadyRemoved,
}

async fn remove_privileged_launcher() -> Result<LauncherCleanup, String> {
    if SIDECAR_GRPC_CLIENT.lock().await.is_none() {
        if cleanup_already_complete().await? {
            return Ok(LauncherCleanup::AlreadyRemoved);
        }
        if uses_scheduled_task().await {
            let state = tokio::task::spawn_blocking(launcher::state)
                .await
                .map_err(|e| format!("cannot inspect the privileged launcher: {e}"))?;
            if state != launcher::LauncherState::Ready {
                return Err(format!(
                    "the elevated sidecar is not running and the launcher is {state:?}"
                ));
            }
        }
        if !commands::start_sidecar().await.is_on_its_way()
            || !wait_until_started(launcher::START_TIMEOUT).await
        {
            return Err("the elevated sidecar could not be started for cleanup".to_string());
        }
    }
    let Some(mut client) = SIDECAR_GRPC_CLIENT.lock().await.clone() else {
        return Err("the elevated sidecar did not connect for cleanup".to_string());
    };
    match tokio::time::timeout(
        Duration::from_secs(5),
        client.remove_privileged_launcher(tonic::Request::new(
            crate::Models::elevated_sidecar::Empty {},
        )),
    )
    .await
    {
        Ok(Ok(response)) => match response.into_inner().installation_retained {
            true => Ok(LauncherCleanup::RetainInstallation),
            false => Ok(LauncherCleanup::RemoveInstallation),
        },
        Ok(Err(e)) => Err(e.message().to_string()),
        Err(_) => Err("cleanup timed out".to_string()),
    }
}

async fn cleanup_already_complete() -> Result<bool, String> {
    if wait_until_privileged_launcher_removed(Duration::from_secs(1)).await {
        let task_exists = tokio::task::spawn_blocking(|| {
            let sid = oyasumivr_shared::windows::current_user_sid()?;
            oyasumivr_shared::task::exists(&sid)
        })
        .await
        .map_err(|e| format!("cannot inspect the scheduled task: {e}"))?
        .map_err(|e| format!("cannot inspect the scheduled task: {e}"))?;
        return Ok(!task_exists);
    }
    Ok(false)
}

fn remove_launcher_handshake() -> Result<(), String> {
    let path = oyasumivr_shared::handshake::path()
        .map_err(|e| format!("cannot resolve the launcher handshake: {e}"))?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot delete {}: {e}", path.display())),
    }
}

async fn wait_until_privileged_launcher_removed(timeout: Duration) -> bool {
    let Some(dir) = launcher::privileged_dir() else {
        return false;
    };
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if !dir.exists() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Returned when a sidecar reports in that the core never asked for. The gRPC layer turns it into
/// an error status, which the sidecar treats as fatal.
#[derive(Debug)]
pub struct SidecarRejected;

impl std::fmt::Display for SidecarRejected {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "this sidecar was not requested")
    }
}

impl std::error::Error for SidecarRejected {}

pub async fn handle_elevated_sidecar_start(
    args: &ElevatedSidecarStartArgs,
) -> Result<(), Box<dyn std::error::Error>> {
    let manager_guard = SIDECAR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    if !manager
        .handle_start_signal(Some(args.grpc_port), Some(args.grpc_web_port), args.pid)
        .await
    {
        return Err(Box::new(SidecarRejected));
    }
    drop(manager_guard);
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    // Create new GRPC client
    let mut grpc_client = tokio::time::timeout(
        Duration::from_secs(2),
        OyasumiElevatedSidecarClient::connect(format!("http://127.0.0.1:{}", args.grpc_port)),
    )
    .await??;
    let consent_result = tokio::time::timeout(
        Duration::from_millis(500),
        grpc_client.set_error_reporting_enabled(tonic::Request::new(
            crate::Models::elevated_sidecar::SetErrorReportingEnabledRequest {
                enabled: ERROR_REPORTING_ENABLED.load(Ordering::Relaxed),
            },
        )),
    )
    .await;
    if !matches!(consent_result, Ok(Ok(_))) {
        warn!("[Core] Elevated sidecar did not acknowledge startup error reporting consent");
    }
    *client_guard = Some(grpc_client);
    drop(client_guard);
    send_event("ELEVATED_SIDECAR_STARTED", args.grpc_web_port).await;
    Ok(())
}
