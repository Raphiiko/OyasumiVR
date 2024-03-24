use tokio::sync::Mutex;

use crate::{
    utils::{models::MdnsSidecarMode, send_event, sidecar_manager::SidecarManager},
    Models::oyasumi_core::MdnsSidecarStartArgs,
};

lazy_static! {
    static ref SIDECAR_MANAGER: Mutex<Option<SidecarManager>> = Default::default();
}

pub async fn init() {
    let (tx, mut rx) = tokio::sync::mpsc::channel(10);
    *SIDECAR_MANAGER.lock().await = Some(SidecarManager::new(
        "MDNS".to_string(),
        "resources/dotnet-sidecars/".to_string(),
        "mdns-sidecar.exe".to_string(),
        tx,
        true,
        vec![],
    ));
    // Listen for sidecar stop signals
    tokio::spawn(async move {
        while let Some(_) = rx.recv().await {
            send_event("MDNS_SIDECAR_STOPPED", ()).await;
        }
    });
}

pub async fn handle_mdns_sidecar_start(
    args: &MdnsSidecarStartArgs,
) -> Result<(), Box<dyn std::error::Error>> {
    let manager_guard = SIDECAR_MANAGER.lock().await;
    let manager = manager_guard.as_ref().unwrap();
    // Ignore this signal if it is invalid
    if !manager
        .handle_start_signal(None, None, args.pid, None)
        .await
    {
        return Ok(());
    }
    send_event("MDNS_SIDECAR_STARTED", true).await;
    Ok(())
}

pub async fn start_mdns_sidecar(osc_port: u16, oscquery_port: u16) {
    match crate::utils::cli_sidecar_mdns_mode().await {
        // In release mode, start the sidecar like normal
        MdnsSidecarMode::Release => {
            let mut sidecar_manager_guard = SIDECAR_MANAGER.lock().await;
            let sidecar_manager = sidecar_manager_guard.as_mut().unwrap();
            sidecar_manager
                .set_args(vec![format!("{}", osc_port), format!("{}", oscquery_port)])
                .await;
            sidecar_manager.start_or_restart().await;
        }
        // In development mode, we expect the sidecar to be started in development mode manually
        MdnsSidecarMode::Dev => {
            let _ = handle_mdns_sidecar_start(&MdnsSidecarStartArgs { pid: 0 }).await;
        }
    }
}
