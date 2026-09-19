use oyasumivr_frame_desktop::{
    controller::{Action, Controller, State},
    discovery::{self, Candidate},
    identity::Identity,
    storage::Store,
    Error,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

static STOPPING: AtomicBool = AtomicBool::new(false);

pub fn init(app: &tauri::AppHandle) -> Result<(), Error> {
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| Error::Persistence)?
        .join("private-frame-pairings");
    let bundle = app
        .path()
        .resource_dir()
        .map_err(|_| Error::ArtifactUnavailable)?
        .join("resources/frame-companion");
    let controller = Controller::new(Store::open(data)?, bundle);
    let mut events = controller.subscribe();
    let handle = app.clone();
    let event_controller = controller.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(state) => {
                    let _ = handle.emit("frame-pairing-state", state);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    for state in event_controller.states() {
                        let _ = handle.emit("frame-pairing-state", state);
                    }
                }
                Err(_) => return,
            }
        }
    });
    app.manage(controller.clone());
    controller.startup()?;
    Ok(())
}

pub fn begin_shutdown(app: &tauri::AppHandle) -> bool {
    !STOPPING.swap(true, Ordering::SeqCst) && app.try_state::<Arc<Controller>>().is_some()
}

pub fn shutdown(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Some(controller) = app.try_state::<Arc<Controller>>() {
            controller.shutdown().await;
        }
        app.exit(0);
    });
}

#[tauri::command]
pub async fn frame_discover(address: Option<String>) -> Result<Vec<Candidate>, Error> {
    match address {
        Some(address) => Ok(vec![discovery::explicit(address)?]),
        None => discovery::discover(CancellationToken::new()).await,
    }
}

#[tauri::command]
pub async fn frame_select(
    controller: tauri::State<'_, Arc<Controller>>,
    device_manager_id: String,
    candidate: Candidate,
) -> Result<Uuid, Error> {
    let (serial, model, manufacturer) = crate::openvr::pairing_identity(&device_manager_id)
        .await
        .ok_or(Error::IdentityUnverified)?;
    let pc = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".into());
    controller
        .select(
            device_manager_id,
            Identity {
                serial,
                model,
                manufacturer,
            },
            candidate,
            pc,
        )
        .await
}

#[tauri::command]
pub fn frame_run(
    controller: tauri::State<'_, Arc<Controller>>,
    pairing_id: Uuid,
    action: Action,
) -> Result<Uuid, Error> {
    controller.inner().start(pairing_id, action)
}

#[tauri::command]
pub fn frame_cancel(
    controller: tauri::State<'_, Arc<Controller>>,
    pairing_id: Uuid,
    operation_id: Uuid,
) -> Result<(), Error> {
    controller.cancel(pairing_id, operation_id)
}

#[tauri::command]
pub fn frame_state(controller: tauri::State<'_, Arc<Controller>>) -> Result<Vec<State>, Error> {
    controller.onboarding.store.records()?;
    Ok(controller.states())
}

#[tauri::command]
pub async fn frame_reconnect_at(
    controller: tauri::State<'_, Arc<Controller>>,
    pairing_id: Uuid,
    candidate: Candidate,
) -> Result<Uuid, Error> {
    controller.inner().reconnect_at(pairing_id, candidate).await
}
