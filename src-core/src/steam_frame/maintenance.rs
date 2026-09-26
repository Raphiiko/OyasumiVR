use std::{collections::HashSet, sync::LazyLock, time::Duration};

use log::{info, warn};
use serde::Serialize;
use tokio::sync::Mutex;

use super::{
    models::Pairing,
    setup::{
        self, bundled_digest, InstallDecision, InstallError, BUNDLED_VERSION, EXIT_BUSY,
        EXIT_CHANGED, EXIT_MISSING,
    },
    ssh::{self, Session, SshError},
    wss::{self, WssError},
};

/// Must stay under the SSH inactivity timeout in ssh.rs, because the session waits meanwhile.
const VERIFY_LIMIT: Duration = Duration::from_secs(30);

/// Pairings that used this app start's one automatic update.
static AUTOMATIC_UPDATES: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
/// Pairings that used this app start's one repair of a helper that does not start.
static AUTOMATIC_REPAIRS: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// Returns true once per pairing and app start.
pub async fn take_automatic_attempt(pairing_id: &str) -> bool {
    AUTOMATIC_UPDATES.lock().await.insert(pairing_id.to_owned())
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FailReason {
    /// The headset stopped answering over SSH.
    Unreachable,
    /// The uploaded helper arrived damaged.
    Corrupted,
    /// The new helper did not start, so the previous one runs again.
    NotStarted,
    /// This build carries no helper.
    NotBundled,
    Other,
}

#[derive(Debug, PartialEq)]
pub enum UpdateOutcome {
    Updated {
        version: String,
    },
    /// The helper already runs the bundled version, or a newer one this app can use.
    Unchanged,
    NeedsAppUpdate,
    Missing,
    Busy,
    Failed(FailReason),
    HostKeyChanged,
    Rejected,
}

/// Brings the helper to the bundled version over one SSH session, and verifies the result over
/// WSS. A failed verification points the helper back at its previous release.
pub async fn update(pairing: &Pairing) -> UpdateOutcome {
    let Some(digest) = bundled_digest() else {
        return UpdateOutcome::Failed(FailReason::NotBundled);
    };
    let session = match ssh::connect(&pairing.access).await {
        Ok(session) => session,
        Err(error) => return ssh_outcome(error),
    };
    let outcome = update_session(&session, pairing, digest).await;
    session.close().await;
    info!("[SteamFrame] Helper update finished: {outcome:?}");
    outcome
}

fn ssh_outcome(error: SshError) -> UpdateOutcome {
    match error {
        SshError::HostKeyChanged => UpdateOutcome::HostKeyChanged,
        SshError::Rejected => UpdateOutcome::Rejected,
        SshError::Unreachable => UpdateOutcome::Failed(FailReason::Unreachable),
        SshError::Failed(message) => {
            warn!("[SteamFrame] Helper update failed: {message}");
            UpdateOutcome::Failed(FailReason::Other)
        }
    }
}

async fn update_session(session: &Session, pairing: &Pairing, digest: &str) -> UpdateOutcome {
    // install the bundled helper when the installed one needs it
    let inspected = match setup::install_bundled(session, false, false).await {
        Ok(inspected) => inspected,
        Err(error) => return install_failure(error),
    };

    // otherwise finish an interrupted update, or stop because nothing changes
    let bundled_on_disk = inspected
        .installed
        .as_ref()
        .is_some_and(|info| info.version == BUNDLED_VERSION);
    match inspected.decision {
        InstallDecision::NeedsAppUpdate => return UpdateOutcome::NeedsAppUpdate,
        _ if inspected.replaced => keep_uninstaller(session).await,
        _ if bundled_on_disk && verify(pairing, Some(digest)).await => {
            prune(session).await;
            return UpdateOutcome::Unchanged;
        }
        // an interrupted update can leave the old process running after the switch
        _ if bundled_on_disk => match setup::run(session, &["start"], b"").await {
            Ok(output) if output.status == 0 => {}
            Ok(output) if output.status == EXIT_BUSY => return UpdateOutcome::Busy,
            Ok(output) => warn!(
                "[SteamFrame] Starting the helper exited with {}",
                output.status
            ),
            Err(error) => return ssh_outcome(error),
        },
        _ => return UpdateOutcome::Unchanged,
    }

    // keep the new helper once it answers
    if verify(pairing, Some(digest)).await {
        prune(session).await;
        return UpdateOutcome::Updated {
            version: BUNDLED_VERSION.to_owned(),
        };
    }

    // else roll back, unless another PC replaced the helper meanwhile
    match setup::run(session, &["rollback", BUNDLED_VERSION], b"").await {
        Ok(output) if output.status == EXIT_CHANGED => {
            info!("[SteamFrame] Another PC replaced the helper during this update");
            return UpdateOutcome::Unchanged;
        }
        Ok(output) if output.status == 0 => {
            warn!("[SteamFrame] The updated helper did not answer, so the previous release runs again")
        }
        Ok(output) => warn!(
            "[SteamFrame] Rolling the helper back exited with {}",
            output.status
        ),
        Err(error) => warn!("[SteamFrame] Could not roll the helper back: {error:?}"),
    }
    UpdateOutcome::Failed(FailReason::NotStarted)
}

async fn keep_uninstaller(session: &Session) {
    if let Err(error) = setup::write_uninstaller(session).await {
        warn!("[SteamFrame] Could not write the uninstall script: {error:?}");
    }
}

async fn prune(session: &Session) {
    if let Err(error) = setup::run(session, &["prune"], b"").await {
        warn!("[SteamFrame] Could not remove old helper releases: {error:?}");
    }
}

fn install_failure(error: InstallError) -> UpdateOutcome {
    match error {
        InstallError::Missing => UpdateOutcome::Missing,
        InstallError::Busy => UpdateOutcome::Busy,
        InstallError::Corrupted => UpdateOutcome::Failed(FailReason::Corrupted),
        InstallError::Ssh(error) => ssh_outcome(error),
        InstallError::Failed(message) => {
            warn!("[SteamFrame] Helper update failed: {message}");
            UpdateOutcome::Failed(FailReason::Other)
        }
    }
}

/// Waits up to VERIFY_LIMIT for an authenticated handshake. With a digest, only the bundled
/// helper counts.
async fn verify(pairing: &Pairing, digest: Option<&str>) -> bool {
    tokio::time::timeout(VERIFY_LIMIT, verify_until_answer(pairing, digest))
        .await
        .unwrap_or(false)
}

async fn verify_until_answer(pairing: &Pairing, digest: Option<&str>) -> bool {
    loop {
        let result = wss::connect(
            &pairing.access.address,
            pairing.port,
            &pairing.cert_pin,
            &pairing.id,
            &pairing.token,
        )
        .await;
        match result {
            Ok((socket, hello)) => {
                wss::close(socket).await;
                return digest.is_none_or(|digest| {
                    hello.info.version == BUNDLED_VERSION
                        && hello.info.digest.as_deref() == Some(digest)
                });
            }
            Err(WssError::Unreachable) => tokio::time::sleep(Duration::from_millis(500)).await,
            Err(_) => return false,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Recovery {
    Running,
    Missing,
    /// The helper stays down, or another PC holds the maintenance lock.
    Down,
    Unreachable,
    HostKeyChanged,
    Rejected,
}

/// Brings back a helper that does not answer while SSH works: start it, then, once per app start,
/// repair the current release and finally roll back to the previous one.
pub async fn recover(pairing: &Pairing) -> Recovery {
    let session = match ssh::connect(&pairing.access).await {
        Ok(session) => session,
        Err(SshError::Unreachable) => return Recovery::Unreachable,
        Err(SshError::HostKeyChanged) => return Recovery::HostKeyChanged,
        Err(SshError::Rejected) => return Recovery::Rejected,
        Err(SshError::Failed(message)) => {
            warn!("[SteamFrame] Could not reach the headset to start the helper: {message}");
            return Recovery::Unreachable;
        }
    };
    let recovery = recover_session(&session, pairing).await;
    session.close().await;
    info!("[SteamFrame] Helper recovery finished: {recovery:?}");
    recovery
}

async fn recover_session(session: &Session, pairing: &Pairing) -> Recovery {
    // start the service
    match setup::run(session, &["start"], b"").await {
        Ok(output) if output.status == EXIT_MISSING => return Recovery::Missing,
        Ok(output) if output.status == EXIT_BUSY => return Recovery::Down,
        Ok(_) => {}
        Err(_) => return Recovery::Down,
    }
    if verify(pairing, None).await {
        return Recovery::Running;
    }

    // once per app start, repair the current release
    if !AUTOMATIC_REPAIRS.lock().await.insert(pairing.id.clone()) {
        return Recovery::Down;
    }
    // rollback below applies only to the release that is current now
    let mut current = match setup::run(session, &["current"], b"").await {
        Ok(output) if output.status == 0 => output.stdout().trim().to_owned(),
        _ => return Recovery::Down,
    };
    warn!("[SteamFrame] The helper does not start, so the current release is repaired");
    match setup::install_bundled(session, true, false).await {
        Ok(inspected) if inspected.replaced => {
            keep_uninstaller(session).await;
            if verify(pairing, bundled_digest()).await {
                return Recovery::Running;
            }
            current = BUNDLED_VERSION.to_owned();
        }
        Ok(_) => {}
        Err(InstallError::Missing) => return Recovery::Missing,
        Err(InstallError::Busy) => return Recovery::Down,
        Err(error) => warn!("[SteamFrame] Could not repair the helper: {error:?}"),
    }

    // then roll back to the previous release
    if current.is_empty() {
        return Recovery::Down;
    }
    warn!("[SteamFrame] The repaired helper does not start, so the previous release runs again");
    let rolled_back = matches!(
        setup::run(session, &["rollback", &current], b"").await,
        Ok(output) if output.status == 0
    );
    if rolled_back && verify(pairing, None).await {
        Recovery::Running
    } else {
        Recovery::Down
    }
}
