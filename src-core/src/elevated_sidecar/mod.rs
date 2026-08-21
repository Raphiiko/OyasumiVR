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

#[allow(dead_code)]
pub async fn request_stop() {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = match client_guard.as_mut() {
        Some(client) => client,
        None => return,
    };
    info!("[Core] Stopping current sidecar...");
    let _ = client
        .request_stop(tonic::Request::new(
            crate::Models::elevated_sidecar::Empty {},
        ))
        .await;
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
