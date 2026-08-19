pub mod commands;

use crate::utils::sidecar_manager::SidecarManager;
use crate::Models::overlay_sidecar::MicrophoneActivityMode;
use crate::{
    utils::send_event,
    Models::overlay_sidecar::oyasumi_overlay_sidecar_client::OyasumiOverlaySidecarClient,
    Models::oyasumi_core::OverlaySidecarStartArgs,
};
use log::warn;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock,
    },
    time::Duration,
};
use tokio::sync::Mutex;
use tonic::transport::Channel;

pub static SIDECAR_GRPC_CLIENT: LazyLock<Mutex<Option<OyasumiOverlaySidecarClient<Channel>>>> =
    LazyLock::new(Default::default);
static SIDECAR_MANAGER: LazyLock<Mutex<Option<SidecarManager>>> = LazyLock::new(Default::default);
static ERROR_REPORTING_ENABLED: AtomicBool = AtomicBool::new(false);
pub async fn init() {
    let (tx, mut rx) = tokio::sync::mpsc::channel(10);
    *SIDECAR_MANAGER.lock().await = Some(SidecarManager::new(
        "OVERLAY".to_string(),
        "resources/dotnet-sidecars/".to_string(),
        "oyasumivr-overlay-sidecar.exe".to_string(),
        tx,
        true,
        vec![],
    ));
    // Listen for sidecar stop signals
    tokio::spawn(async move {
        while rx.recv().await.is_some() {
            *SIDECAR_GRPC_CLIENT.lock().await = None;
            send_event("OVERLAY_SIDECAR_STOPPED", ()).await;
        }
    });
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
    manager
        .set_arg("--error-reporting-enabled", enabled, true)
        .await;
    drop(manager_guard);

    let client = SIDECAR_GRPC_CLIENT.lock().await.clone();
    let Some(mut client) = client else {
        return;
    };
    for attempt in 0..3 {
        let result = tokio::time::timeout(
            Duration::from_millis(500),
            client.set_error_reporting_enabled(tonic::Request::new(
                crate::Models::overlay_sidecar::SetErrorReportingEnabledRequest { enabled },
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
        warn!("[Core] Failed to enable overlay sidecar error reporting");
        return;
    }
    warn!("[Core] Failed to update overlay sidecar error reporting consent; restarting it");
    if let Some(manager) = SIDECAR_MANAGER.lock().await.as_mut() {
        manager.start_or_restart().await;
    }
}

pub async fn handle_overlay_sidecar_start(
    args: &OverlaySidecarStartArgs,
) -> Result<(), Box<dyn std::error::Error>> {
    let manager_guard = SIDECAR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    // Ignore this signal if it is invalid
    if !manager
        .handle_start_signal(
            Some(args.grpc_port),
            Some(args.grpc_web_port),
            args.pid,
            None,
        )
        .await
    {
        return Ok(());
    }
    drop(manager_guard);
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    // Create new GRPC client
    let mut grpc_client = tokio::time::timeout(
        Duration::from_secs(2),
        OyasumiOverlaySidecarClient::connect(format!("http://127.0.0.1:{}", args.grpc_port)),
    )
    .await??;
    let consent_result = tokio::time::timeout(
        Duration::from_millis(500),
        grpc_client.set_error_reporting_enabled(tonic::Request::new(
            crate::Models::overlay_sidecar::SetErrorReportingEnabledRequest {
                enabled: ERROR_REPORTING_ENABLED.load(Ordering::Relaxed),
            },
        )),
    )
    .await;
    if !matches!(consent_result, Ok(Ok(_))) {
        warn!("[Core] Overlay sidecar did not acknowledge startup error reporting consent");
    }
    *client_guard = Some(grpc_client);
    drop(client_guard);
    send_event("OVERLAY_SIDECAR_STARTED", args.grpc_web_port).await;
    Ok(())
}

pub async fn set_microphone_active(active: bool, mode: MicrophoneActivityMode) {
    let mut client_guard = SIDECAR_GRPC_CLIENT.lock().await;
    let client = match client_guard.as_mut() {
        Some(client) => client,
        None => return,
    };
    let _ = client
        .set_microphone_active(tonic::Request::new(
            crate::Models::overlay_sidecar::SetMicrophoneActiveRequest {
                active,
                mode: mode as i32,
            },
        ))
        .await;
}
