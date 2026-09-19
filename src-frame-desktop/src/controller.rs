use crate::{
    connection::Connection,
    identity::{self, Identity},
    lifecycle::{self, Bundle, Maintenance},
    onboarding::Onboarding,
    provision::{self, Provision},
    storage::{Companion, Record, Store},
    Error, Result,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Pair,
    Retry,
    Repair,
    Unpair,
    ForgetLocal,
}

#[derive(Clone, Debug, Serialize)]
pub struct State {
    pub device_manager_id: String,
    pub in_progress: bool,
    pub pairing_id: Uuid,
    pub operation_id: Uuid,
    pub step: Step,
    pub paired: bool,
    pub connected: bool,
    pub companion_installed: Option<bool>,
    pub steamvr_ready: bool,
    pub error: Option<Error>,
    pub maintenance_error: Option<Error>,
    pub remote_removal_performed: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    Selected,
    VerifyingSsh,
    AwaitingApproval,
    VerifyingIdentity,
    Installing,
    VerifyingCompanion,
    Connected,
    Offline,
    RepairNeeded,
    Removing,
    Forgotten,
    FinishingCleanup,
    Cancelled,
    Failed,
}

struct Active {
    operation: Uuid,
    cancel: CancellationToken,
}
struct Watcher {
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<()>,
}

pub struct Controller {
    pub onboarding: Onboarding,
    bundle: PathBuf,
    states: Mutex<HashMap<Uuid, State>>,
    active: Mutex<HashMap<Uuid, Active>>,
    watchers: Mutex<HashMap<Uuid, Watcher>>,
    events: broadcast::Sender<State>,
    selection: tokio::sync::Mutex<()>,
    stopping: std::sync::atomic::AtomicBool,
    latest: Mutex<HashMap<Uuid, Uuid>>,
}

impl Controller {
    pub fn new(store: Store, bundle: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            onboarding: Onboarding::new(store),
            bundle,
            states: Mutex::new(HashMap::new()),
            active: Mutex::new(HashMap::new()),
            watchers: Mutex::new(HashMap::new()),
            events: broadcast::channel(128).0,
            selection: tokio::sync::Mutex::new(()),
            stopping: std::sync::atomic::AtomicBool::new(false),
            latest: Mutex::new(HashMap::new()),
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<State> {
        self.events.subscribe()
    }
    pub fn states(&self) -> Vec<State> {
        self.states.lock().unwrap().values().cloned().collect()
    }

    pub async fn select(
        &self,
        device_manager_id: String,
        selected: Identity,
        candidate: crate::discovery::Candidate,
        pc: String,
    ) -> Result<Uuid> {
        let _selection = self.selection.try_lock().map_err(|_| Error::Busy)?;
        if candidate.companion_port < 1024 {
            return Err(Error::InvalidInput);
        }
        if let Some(existing) = self
            .onboarding
            .store
            .records()?
            .into_iter()
            .find(|r| r.device_manager_id == device_manager_id)
        {
            return Ok(existing.id);
        }
        let mut record = self
            .onboarding
            .create(
                device_manager_id,
                candidate.address,
                candidate.devkit_port,
                candidate.ssh_port,
                pc,
            )
            .await?;
        record.companion_port = candidate.companion_port;
        record.selected_identity = Some(selected);
        self.onboarding.store.save(&record)?;
        self.update(&record, Uuid::nil(), Step::Selected, None, false);
        Ok(record.id)
    }

    pub fn start(self: &Arc<Self>, id: Uuid, action: Action) -> Result<Uuid> {
        if self.stopping.load(std::sync::atomic::Ordering::Acquire) {
            return Err(Error::Cancelled);
        }
        let initial = self.onboarding.store.load(id)?;
        let mut active = self.active.lock().unwrap();
        if active.contains_key(&id) {
            return Err(Error::Busy);
        }
        let operation = Uuid::new_v4();
        self.latest.lock().unwrap().insert(id, operation);
        let cancel = CancellationToken::new();
        active.insert(
            id,
            Active {
                operation,
                cancel: cancel.clone(),
            },
        );
        let this = self.clone();
        tokio::spawn(async move {
            this.stop_connection(id).await;
            let result = this.run(id, operation, action, &cancel).await;
            if let Err(error) = result {
                let mut record = this
                    .onboarding
                    .store
                    .load(id)
                    .unwrap_or_else(|_| initial.clone());
                if record.completed
                    && !matches!(action, Action::Unpair | Action::ForgetLocal)
                    && matches!(
                        error,
                        Error::RemoteOperation
                            | Error::ArtifactUnavailable
                            | Error::Persistence
                            | Error::SetupIncomplete
                    )
                {
                    record.maintenance_after = now() + 3600;
                    record.maintenance_error = Some(error);
                    let _ = this.onboarding.store.save(&record);
                }
                let step = if error == Error::Cancelled {
                    Step::Cancelled
                } else {
                    Step::Failed
                };
                this.update(&record, operation, step, Some(error), false);
            }
            if let Ok(record) = this.onboarding.store.load(id) {
                if record.completed
                    && !record.repair_needed
                    && !matches!(action, Action::Unpair | Action::ForgetLocal)
                {
                    this.start_connection(record, operation);
                }
            }
            this.active.lock().unwrap().remove(&id);
            if let Some(state) = this.states.lock().unwrap().get_mut(&id) {
                if state.operation_id == operation {
                    state.in_progress = false;
                    let _ = this.events.send(state.clone());
                }
            }
        });
        Ok(operation)
    }

    pub async fn reconnect_at(
        self: &Arc<Self>,
        id: Uuid,
        candidate: crate::discovery::Candidate,
    ) -> Result<Uuid> {
        crate::onboarding::validate_address(&candidate.address)?;
        let mut record = self.onboarding.store.load(id)?;
        let pin = record
            .ssh_host_key
            .clone()
            .ok_or(Error::IdentityUnverified)?;
        let operation = Uuid::new_v4();
        let cancel = CancellationToken::new();
        {
            let mut active = self.active.lock().unwrap();
            if active.contains_key(&id) {
                return Err(Error::Busy);
            }
            active.insert(
                id,
                Active {
                    operation,
                    cancel: cancel.clone(),
                },
            );
        }
        self.latest.lock().unwrap().insert(id, operation);
        self.stop_connection(id).await;
        let result = async {
            let key = self.onboarding.store.secret(record.credential_ref)?;
            let session = tokio::select! {
                _ = cancel.cancelled() => return Err(Error::Cancelled),
                result = crate::ssh::Session::connect(&candidate.address, candidate.ssh_port, "steamos", &key, Some(&pin)) => result?,
            };
            if let Some(companion) = &record.companion {
                let inspection = lifecycle::inspect(&session, &companion.root, &companion.unit).await?;
                lifecycle::verify_owner(&inspection, &id.to_string(), record.verified_device_id.as_deref().ok_or(Error::IdentityUnverified)?, &companion.daemon_id)?;
            }
            if cancel.is_cancelled() { return Err(Error::Cancelled); }
            record.address = candidate.address;
            record.ssh_port = candidate.ssh_port;
            record.devkit_port = candidate.devkit_port;
            self.onboarding.store.save(&record)?;
            session.close().await;
            Ok(())
        }.await;
        self.active.lock().unwrap().remove(&id);
        if let Err(error) = result {
            self.update(&record, operation, Step::Failed, Some(error), false);
            if record.completed && !record.repair_needed {
                self.start_connection(record, operation);
            }
            return Err(error);
        }
        self.start(id, Action::Retry)
    }

    pub fn cancel(&self, id: Uuid, operation: Uuid) -> Result<()> {
        let active = self.active.lock().unwrap();
        let current = active.get(&id).ok_or(Error::InvalidInput)?;
        if current.operation != operation {
            return Err(Error::InvalidInput);
        }
        current.cancel.cancel();
        Ok(())
    }

    pub async fn shutdown(&self) {
        self.stopping
            .store(true, std::sync::atomic::Ordering::Release);
        for active in self.active.lock().unwrap().values() {
            active.cancel.cancel();
        }
        let ids: Vec<_> = self.watchers.lock().unwrap().keys().copied().collect();
        for id in ids {
            self.stop_connection(id).await;
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(130);
        while !self.active.lock().unwrap().is_empty() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    pub fn startup(self: &Arc<Self>) -> Result<()> {
        for record in self.onboarding.store.records()? {
            self.update(&record, Uuid::nil(), Step::Offline, None, false);
            if record.completed && !record.repair_needed && !record.remote_cleanup_confirmed {
                self.start_connection(record, Uuid::nil());
            }
        }
        Ok(())
    }

    fn update(
        &self,
        record: &Record,
        operation: Uuid,
        step: Step,
        error: Option<Error>,
        ready: bool,
    ) {
        if self
            .latest
            .lock()
            .unwrap()
            .get(&record.id)
            .is_some_and(|latest| *latest != operation)
        {
            return;
        }
        if self
            .active
            .lock()
            .unwrap()
            .get(&record.id)
            .is_some_and(|a| a.operation != operation)
        {
            return;
        }
        let state = State {
            device_manager_id: record.device_manager_id.clone(),
            in_progress: self.active.lock().unwrap().contains_key(&record.id),
            pairing_id: record.id,
            operation_id: operation,
            step,
            paired: record.completed,
            connected: matches!(step, Step::Connected),
            companion_installed: if matches!(step, Step::RepairNeeded) {
                Some(false)
            } else if record.completed {
                Some(true)
            } else {
                None
            },
            steamvr_ready: ready,
            error,
            maintenance_error: record.maintenance_error,
            remote_removal_performed: matches!(step, Step::Removing),
        };
        self.states.lock().unwrap().insert(record.id, state.clone());
        let _ = self.events.send(state);
    }

    async fn run(
        &self,
        id: Uuid,
        operation: Uuid,
        action: Action,
        cancel: &CancellationToken,
    ) -> Result<()> {
        let mut record = self.onboarding.store.load(id)?;
        if record.remote_cleanup_confirmed && matches!(action, Action::Unpair) {
            self.onboarding.store.forget(id)?;
            record.completed = false;
            self.update(&record, operation, Step::Removing, None, false);
            return Ok(());
        }
        if matches!(action, Action::ForgetLocal) {
            self.onboarding.store.forget(id)?;
            record.completed = false;
            self.update(&record, operation, Step::Forgotten, None, false);
            return Ok(());
        }
        let bundle = if matches!(action, Action::Unpair) {
            None
        } else {
            Some(Bundle::read(&self.bundle)?)
        };
        self.update(&record, operation, Step::VerifyingSsh, None, false);
        let session = self
            .onboarding
            .access_observe(
                id,
                "steamos",
                matches!(action, Action::Pair),
                cancel.clone(),
                || self.update(&record, operation, Step::AwaitingApproval, None, false),
            )
            .await?;
        record = self.onboarding.store.load(id)?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let home = String::from_utf8(
            session
                .execute(&["bash", "-c", "printf '%s' \"$HOME\""], &[])
                .await?,
        )
        .map_err(|_| Error::RemoteOperation)?;
        if let Some(upload) = record.pending_upload {
            provision::cleanup_session(&session, &home, upload).await?;
            record.pending_upload = None;
            self.onboarding.store.save(&record)?;
        }
        if matches!(action, Action::Unpair) {
            return self.unpair(&session, record, operation).await;
        }
        let bundle = bundle.ok_or(Error::ArtifactUnavailable)?;
        if record.companion.is_none() {
            self.update(&record, operation, Step::VerifyingIdentity, None, false);
            let upload_id = Uuid::new_v4();
            record.pending_upload = Some(upload_id);
            self.onboarding.store.save(&record)?;
            let directory = provision::create_session(&session, &home, upload_id).await?;
            let probe = async {
                let artifact = format!("{directory}/artifact");
                lifecycle::upload(&session, &artifact, &bundle.artifact).await?;
                let hash = session.execute(&["sha256sum", &artifact], &[]).await?;
                if hash.split(|b| b.is_ascii_whitespace()).next()
                    != Some(bundle.manifest.artifact_sha256.as_bytes())
                {
                    return Err(Error::ArtifactUnavailable);
                }
                session.execute(&["chmod", "700", &artifact], &[]).await?;
                let library = format!(
                    "/opt/steamvr/bin/{}/libopenvr_api.so",
                    if bundle.manifest.architecture == "aarch64" {
                        "linuxarm64"
                    } else {
                        "linux64"
                    }
                );
                let bytes = session
                    .execute(&[&artifact, "probe-identity", &library], &[])
                    .await?;
                let value: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|_| Error::IdentityUnverified)?;
                if value["build_version"] != bundle.manifest.build_version {
                    return Err(Error::ArtifactUnavailable);
                }
                let remote: Identity = serde_json::from_value(value["identity"].clone())
                    .map_err(|_| Error::IdentityUnverified)?;
                identity::reconcile(
                    record
                        .selected_identity
                        .as_ref()
                        .ok_or(Error::IdentityUnverified)?,
                    &remote,
                )
            }
            .await;
            provision::cleanup_session(&session, &home, upload_id).await?;
            record.pending_upload = None;
            self.onboarding.store.save(&record)?;
            let device = probe?;
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let provision = Provision::generate()?;
            let credential_ref = Uuid::new_v4();
            let secret = zeroize::Zeroizing::new(
                serde_json::to_vec(&provision).map_err(|_| Error::Persistence)?,
            );
            self.onboarding.store.put_secret(credential_ref, &secret)?;
            record.verified_device_id = Some(device);
            record.companion = Some(Companion {
                credential_ref,
                daemon_id: provision.daemon_id.clone(),
                certificate_sha256: lifecycle::digest(&provision.server_der),
                root: format!("{home}/.local/share/oyasumivr/frame"),
                unit: "oyasumivr-frame-companion.service".into(),
                home: home.clone(),
                port: record.companion_port,
            });
            self.onboarding.store.save(&record)?;
        }
        let companion = record.companion.clone().ok_or(Error::SetupIncomplete)?;
        let device = record
            .verified_device_id
            .clone()
            .ok_or(Error::IdentityUnverified)?;
        let secret = self.onboarding.store.secret(companion.credential_ref)?;
        let provision: Provision =
            serde_json::from_slice(&secret).map_err(|_| Error::Persistence)?;
        if lifecycle::digest(&provision.server_der) != companion.certificate_sha256
            || provision.daemon_id != companion.daemon_id
        {
            return Err(Error::Persistence);
        }
        let mut inspected = lifecycle::inspect(&session, &companion.root, &companion.unit).await?;
        lifecycle::verify_owner(&inspected, &id.to_string(), &device, &companion.daemon_id)?;
        if inspected.transaction_phase.is_some() {
            lifecycle::invoke_owned(
                &session,
                &["recover", &companion.root, &companion.unit],
                &id.to_string(),
                &device,
            )
            .await?;
            inspected = lifecycle::inspect(&session, &companion.root, &companion.unit).await?;
            lifecycle::verify_owner(&inspected, &id.to_string(), &device, &companion.daemon_id)?;
        }
        let decision = lifecycle::policy(&inspected, &bundle.manifest, record.completed)?;
        if decision == Maintenance::RepairNeeded && !matches!(action, Action::Repair) {
            record.repair_needed = true;
            self.onboarding.store.save(&record)?;
            self.update(&record, operation, Step::RepairNeeded, None, false);
            return Ok(());
        }
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if matches!(action, Action::Repair) || decision == Maintenance::Update {
            if record.maintenance_after > now() && !matches!(action, Action::Repair) {
                return Err(Error::MaintenanceBackoff);
            }
            self.update(&record, operation, Step::Installing, None, false);
            let upload_id = Uuid::new_v4();
            record.pending_upload = Some(upload_id);
            self.onboarding.store.save(&record)?;
            let directory = provision::create_session(&session, &home, upload_id).await?;
            let library = format!(
                "/opt/steamvr/bin/{}/libopenvr_api.so",
                if bundle.manifest.architecture == "aarch64" {
                    "linuxarm64"
                } else {
                    "linux64"
                }
            );
            let target = provision::Installation {
                root: &companion.root,
                unit: &companion.unit,
                pairing: &id.to_string(),
                device: &device,
                home: &home,
                public_key: &record.public_key,
                port: companion.port,
                openvr_library: Some(&library),
            };
            let applied =
                provision::apply(&session, &bundle, &target, &provision, &directory).await;
            if cancel.is_cancelled() {
                self.update(&record, operation, Step::FinishingCleanup, None, false);
            }
            provision::cleanup_session(&session, &home, upload_id).await?;
            record.pending_upload = None;
            if applied.is_err() {
                record.maintenance_after = now() + 3600;
                record.maintenance_error = applied.as_ref().err().copied();
            }
            self.onboarding.store.save(&record)?;
            applied?;
        }
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        self.update(&record, operation, Step::VerifyingCompanion, None, false);
        let connection = Connection::connect(
            &record.address,
            companion.port,
            &provision.server_der,
            "oyasumivr-frame-companion",
            &provision.token,
            &device,
            &companion.daemon_id,
        )
        .await?;
        if (!record.completed
            || matches!(action, Action::Repair)
            || decision == Maintenance::Update)
            && connection.build != bundle.manifest.build_version
        {
            return Err(Error::ProtocolMismatch);
        }
        record.completed = true;
        record.repair_needed = false;
        record.last_contact = Some(now());
        record.maintenance_after = 0;
        record.maintenance_error = None;
        self.onboarding.store.save(&record)?;
        self.update(
            &record,
            operation,
            Step::Connected,
            None,
            connection.steamvr == oyasumivr_frame_protocol::SteamVrState::Ready,
        );
        connection.close().await;
        session.close().await;
        Ok(())
    }

    async fn unpair(
        &self,
        session: &crate::ssh::Session,
        mut record: Record,
        operation: Uuid,
    ) -> Result<()> {
        let Some(companion) = record.companion.as_ref() else {
            lifecycle::remove_owned_key(session, &record.public_key).await?;
            record.remote_cleanup_confirmed = true;
            self.onboarding.store.save(&record)?;
            self.onboarding.store.forget(record.id)?;
            record.completed = false;
            self.update(&record, operation, Step::Removing, None, false);
            return Ok(());
        };
        let inspected = lifecycle::inspect(session, &companion.root, &companion.unit).await?;
        lifecycle::verify_owner(
            &inspected,
            &record.id.to_string(),
            record
                .verified_device_id
                .as_deref()
                .ok_or(Error::IdentityUnverified)?,
            &companion.daemon_id,
        )?;
        if inspected.transaction_phase.is_some() {
            lifecycle::invoke_owned(
                session,
                &["recover", &companion.root, &companion.unit],
                &record.id.to_string(),
                record
                    .verified_device_id
                    .as_deref()
                    .ok_or(Error::IdentityUnverified)?,
            )
            .await?;
        }
        lifecycle::invoke_owned(
            session,
            &["uninstall", &companion.root, &companion.unit],
            &record.id.to_string(),
            record
                .verified_device_id
                .as_deref()
                .ok_or(Error::IdentityUnverified)?,
        )
        .await?;
        if lifecycle::inspect(session, &companion.root, &companion.unit)
            .await?
            .installation
            != "absent"
        {
            return Err(Error::RemoteOperation);
        }
        lifecycle::remove_owned_key(session, &record.public_key).await?;
        record.remote_cleanup_confirmed = true;
        self.onboarding.store.save(&record)?;
        self.onboarding.store.forget(record.id)?;
        record.completed = false;
        self.update(&record, operation, Step::Removing, None, false);
        Ok(())
    }

    async fn stop_connection(&self, id: Uuid) {
        let watcher = self.watchers.lock().unwrap().remove(&id);
        if let Some(watcher) = watcher {
            watcher.cancel.cancel();
            let _ = watcher.task.await;
        }
    }

    fn start_connection(self: &Arc<Self>, mut record: Record, operation: Uuid) {
        if self.stopping.load(std::sync::atomic::Ordering::Acquire) {
            return;
        }
        let mut watchers = self.watchers.lock().unwrap();
        if watchers.contains_key(&record.id) {
            return;
        }
        let cancel = CancellationToken::new();
        let stopping = cancel.clone();
        let this = self.clone();
        let id = record.id;
        let task = tokio::spawn(async move {
            let Some(companion) = record.companion.clone() else {
                this.update(
                    &record,
                    operation,
                    Step::Failed,
                    Some(Error::Persistence),
                    false,
                );
                return;
            };
            let Some(device) = record.verified_device_id.clone() else {
                this.update(
                    &record,
                    operation,
                    Step::Failed,
                    Some(Error::Persistence),
                    false,
                );
                return;
            };
            let Ok(secret) = this.onboarding.store.secret(companion.credential_ref) else {
                this.update(
                    &record,
                    operation,
                    Step::Failed,
                    Some(Error::Persistence),
                    false,
                );
                return;
            };
            let Ok(provision) = serde_json::from_slice::<Provision>(&secret) else {
                this.update(
                    &record,
                    operation,
                    Step::Failed,
                    Some(Error::Persistence),
                    false,
                );
                return;
            };
            if lifecycle::digest(&provision.server_der) != companion.certificate_sha256
                || provision.daemon_id != companion.daemon_id
            {
                this.update(
                    &record,
                    operation,
                    Step::Failed,
                    Some(Error::Persistence),
                    false,
                );
                return;
            }
            let mut delay = 1;
            loop {
                let connection = tokio::select! { _ = stopping.cancelled() => return,
                result = Connection::connect(&record.address, companion.port, &provision.server_der, "oyasumivr-frame-companion", &provision.token, &device, &companion.daemon_id) => result };
                match connection {
                    Ok(mut connection) => {
                        if stopping.is_cancelled() {
                            connection.close().await;
                            return;
                        }
                        record.last_contact = Some(now());
                        if this.onboarding.store.save(&record).is_err() {
                            this.update(
                                &record,
                                operation,
                                Step::Failed,
                                Some(Error::Persistence),
                                false,
                            );
                            connection.close().await;
                            return;
                        }
                        delay = 1;
                        let update_due = Bundle::read(&this.bundle)
                            .ok()
                            .and_then(|bundle| {
                                Some(
                                    semver::Version::parse(&connection.build).ok()?
                                        < semver::Version::parse(&bundle.manifest.build_version)
                                            .ok()?,
                                )
                            })
                            .unwrap_or(false)
                            && record.maintenance_after <= now();
                        if update_due {
                            connection.close().await;
                            match this.start(record.id, Action::Retry) {
                                Err(Error::Busy) => {
                                    tokio::time::sleep(Duration::from_millis(100)).await;
                                    continue;
                                }
                                _ => return,
                            }
                        }
                        loop {
                            this.update(
                                &record,
                                operation,
                                Step::Connected,
                                None,
                                connection.steamvr == oyasumivr_frame_protocol::SteamVrState::Ready,
                            );
                            tokio::select! { _ = stopping.cancelled() => { connection.close().await; return; }, _ = tokio::time::sleep(Duration::from_secs(5)) => {} }
                            if connection.status().await.is_err() {
                                break;
                            }
                        }
                        connection.close().await;
                    }
                    Err(error) => {
                        this.update(&record, operation, Step::Offline, Some(error), false)
                    }
                }
                tokio::select! { _ = stopping.cancelled() => return, _ = tokio::time::sleep(Duration::from_secs(delay)) => {} }
                delay = (delay * 2).min(60);
            }
        });
        watchers.insert(id, Watcher { cancel, task });
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[tokio::test]
    async fn old_operations_cannot_replace_state_or_cancel_new_work() {
        let directory = tempfile::tempdir().unwrap();
        let controller = Controller::new(
            Store::open(directory.path().into()).unwrap(),
            directory.path().join("absent-bundle"),
        );
        let record = controller
            .onboarding
            .create(
                "synthetic".into(),
                "127.0.0.1".into(),
                32000,
                22,
                "Synthetic".into(),
            )
            .await
            .unwrap();
        let old = Uuid::new_v4();
        let current = Uuid::new_v4();
        controller.latest.lock().unwrap().insert(record.id, current);
        controller.update(&record, old, Step::Connected, None, false);
        assert!(controller.states().is_empty());
        controller.update(&record, current, Step::Selected, None, false);
        assert_eq!(controller.states()[0].operation_id, current);
        let cancel = CancellationToken::new();
        controller.active.lock().unwrap().insert(
            record.id,
            Active {
                operation: current,
                cancel: cancel.clone(),
            },
        );
        assert_eq!(controller.cancel(record.id, old), Err(Error::InvalidInput));
        assert!(!cancel.is_cancelled());
        controller.cancel(record.id, current).unwrap();
        assert!(cancel.is_cancelled());
        controller.active.lock().unwrap().clear();
        use std::os::windows::fs::OpenOptionsExt;
        let mut removed = record;
        removed.remote_cleanup_confirmed = true;
        controller.onboarding.store.save(&removed).unwrap();
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(directory.path().join(format!("{}.json", removed.id)))
            .unwrap();
        assert_eq!(
            controller.onboarding.store.forget(removed.id),
            Err(Error::Persistence)
        );
        assert!(controller
            .onboarding
            .store
            .secret(removed.credential_ref)
            .is_err());
        drop(held);
        let mut events = controller.subscribe();
        controller.start(removed.id, Action::Unpair).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let state = events.recv().await.unwrap();
                assert!(state.error.is_none());
                if !state.in_progress && state.remote_removal_performed {
                    break;
                }
            }
        })
        .await
        .unwrap();
        assert!(controller.onboarding.store.records().unwrap().is_empty());
        controller.shutdown().await;
    }
}
