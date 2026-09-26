use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};

use futures_util::{SinkExt, StreamExt};
use log::{info, warn};
use tokio::{
    sync::{Mutex, Notify},
    task::JoinHandle,
};
use tokio_tungstenite::tungstenite::Message;

use super::{
    discovery,
    maintenance::{self, Recovery, UpdateOutcome},
    models::{Identity, Maintenance, Pairing, State, Status},
    setup::{
        self, bundled_digest, install_decision, InstallDecision, ProvisionError, BUNDLED_VERSION,
    },
    ssh::{self, SshError},
    valid_pc_id,
    wss::{self, Hello, Socket, WssError},
    PROTOCOL_VERSION,
};
use crate::utils::{get_time, send_event};

const EVENT: &str = "STEAM_FRAME_CONNECTION_STATE";
const PING_INTERVAL: Duration = Duration::from_secs(15);
const SILENCE_LIMIT: Duration = Duration::from_secs(40);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
const UPDATED_NOTICE: Duration = Duration::from_secs(60);

struct Connection {
    pairing: Arc<Mutex<Pairing>>,
    task: JoinHandle<()>,
    update: Arc<Notify>,
}

static CONNECTIONS: LazyLock<Mutex<HashMap<String, Connection>>> = LazyLock::new(Default::default);
static STATES: LazyLock<Mutex<HashMap<String, State>>> = LazyLock::new(Default::default);

/// Keeps one connection per pairing. A pairing whose settings are unchanged keeps its connection.
pub async fn set_pairings(pairings: Vec<Pairing>) {
    let mut connections = CONNECTIONS.lock().await;
    let mut kept = HashMap::new();
    // keep unchanged pairings, restart changed or new ones
    for pairing in pairings {
        if !valid_pc_id(&pairing.id) {
            warn!("[SteamFrame] Ignored a pairing with an invalid id");
            continue;
        }
        if let Some(connection) = connections.remove(&pairing.id) {
            if *connection.pairing.lock().await == pairing {
                kept.insert(pairing.id.clone(), connection);
                continue;
            }
            connection.task.abort();
        }
        let id = pairing.id.clone();
        let shared = Arc::new(Mutex::new(pairing));
        let update = Arc::new(Notify::new());
        let task = tokio::spawn(run(shared.clone(), update.clone()));
        let replaced = kept.insert(
            id,
            Connection {
                pairing: shared,
                task,
                update,
            },
        );
        if let Some(replaced) = replaced {
            replaced.task.abort();
        }
    }
    // stop connections whose pairing is gone
    for (id, connection) in connections.drain() {
        connection.task.abort();
        STATES.lock().await.remove(&id);
    }
    *connections = kept;
}

/// Starts a helper update for this pairing. Returns false for an unknown pairing.
pub async fn request_update(pairing_id: &str) -> bool {
    let connections = CONNECTIONS.lock().await;
    let Some(connection) = connections.get(pairing_id) else {
        return false;
    };
    connection.update.notify_one();
    true
}

/// The last state of every running connection.
pub async fn states() -> Vec<State> {
    STATES.lock().await.values().cloned().collect()
}

/// Stores the state and sends it to the UI.
async fn publish(state: &State) {
    STATES
        .lock()
        .await
        .insert(state.pairing_id.clone(), state.clone());
    send_event(EVENT, state.clone()).await;
}

enum Attempt {
    Connected(Box<Socket>, Hello),
    /// Try again at once, because something this PC trusts just changed.
    Retry,
    Failed(Status),
}

/// Keeps one pairing connected for the life of the task, retrying with backoff.
async fn run(shared: Arc<Mutex<Pairing>>, update: Arc<Notify>) {
    // announce that this pairing is connecting
    let initial = shared.lock().await.clone();
    let mut state = State {
        pairing_id: initial.id.clone(),
        status: Status::Connecting,
        last_seen: None,
        helper_version: None,
        update_available: false,
        maintenance: None,
        address: initial.access.address.clone(),
        cert_pin: initial.cert_pin.clone(),
    };
    publish(&state).await;
    let mut backoff = Duration::from_secs(2);
    let mut retries = 0;
    // deadline of the "updated" notice, set by a successful update
    let mut notice: Option<Instant> = None;
    loop {
        // try once; a repair gets at most two immediate retries
        let pairing = shared.lock().await.clone();
        let result = match attempt(&pairing, &shared).await {
            Attempt::Retry if retries >= 2 => Attempt::Failed(Status::Offline),
            result => result,
        };
        match result {
            // connected: update an older helper, refuse an unusable one, or hold
            Attempt::Connected(mut socket, hello) => {
                let pairing = shared.lock().await.clone();
                state.address = pairing.access.address.clone();
                state.cert_pin = pairing.cert_pin.clone();
                state.helper_version = Some(hello.info.version.clone());
                state.update_available = update_available(&hello);
                settle_maintenance(&mut state, &hello, &mut notice);

                // update an older helper, once per app start
                let incompatible = incompatibility(&hello, &pairing.identity);
                if state.update_available
                    && incompatible != Some(Status::IdentityChanged)
                    && maintenance::take_automatic_attempt(&pairing.id).await
                {
                    wss::close(*socket).await;
                    if maintain(&mut state, &pairing, &mut notice).await {
                        return;
                    }
                    continue;
                }

                // refuse an unusable helper, else hold the socket
                if let Some(status) = incompatible {
                    wss::close(*socket).await;
                    if state.status != status {
                        warn!(
                            "[SteamFrame] Helper is unusable ({status:?}): it reports headset {:?} and protocols {}-{}, the pairing expects {:?} and protocol {PROTOCOL_VERSION}",
                            hello.identity, hello.info.protocol_min, hello.info.protocol_max, pairing.identity
                        );
                    }
                    state.status = status;
                    publish(&state).await;
                } else {
                    state.status = Status::Connected;
                    state.last_seen = Some(get_time() as u64);
                    publish(&state).await;
                    backoff = Duration::from_secs(2);
                    retries = 0;
                    let requested =
                        hold_connected(&mut socket, &update, &mut state, &mut notice).await;
                    wss::close(*socket).await;
                    state.last_seen = Some(get_time() as u64);
                    if requested {
                        if maintain(&mut state, &pairing, &mut notice).await {
                            return;
                        }
                    } else {
                        state.status = Status::Offline;
                        publish(&state).await;
                    }
                    continue;
                }
            }
            // something this PC trusts changed, so try again now
            Attempt::Retry => {
                retries += 1;
                continue;
            }
            // failed: report it, stop on a changed host key or removed pairing
            Attempt::Failed(status) => {
                let pairing = shared.lock().await.clone();
                state.address = pairing.access.address;
                state.cert_pin = pairing.cert_pin;
                if state.status != status {
                    state.status = status;
                    publish(&state).await;
                }
                match status {
                    Status::HostKeyChanged => {
                        warn!("[SteamFrame] The headset's SSH host key differs from the pinned one, so the connection stops until it is paired again");
                        return;
                    }
                    Status::PairingRemoved => {
                        warn!("[SteamFrame] The headset rejects this PC's key, so the connection stops until it is paired again");
                        return;
                    }
                    _ => {}
                }
            }
        }
        // wait before the next attempt, doubling up to a minute
        tokio::select! {
            _ = tokio::time::sleep(backoff) => {}
            _ = update.notified() => {
                let pairing = shared.lock().await.clone();
                if maintain(&mut state, &pairing, &mut notice).await {
                    return;
                }
                backoff = Duration::from_secs(2);
                retries = 0;
                continue;
            }
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
        retries = 0;
    }
}

/// Clears a failed or busy notice once no update is needed, and an updated notice once the helper
/// changed or its minute is up.
fn settle_maintenance(state: &mut State, hello: &Hello, notice: &mut Option<Instant>) {
    let settled = match &state.maintenance {
        Some(Maintenance::Failed { .. } | Maintenance::Busy) => !state.update_available,
        Some(Maintenance::Updated { version }) => {
            *version != hello.info.version
                || notice.is_none_or(|deadline| deadline <= Instant::now())
        }
        _ => false,
    };
    if settled {
        state.maintenance = None;
        *notice = None;
    }
}

fn update_available(hello: &Hello) -> bool {
    matches!(
        install_decision(
            Some(&hello.info),
            BUNDLED_VERSION,
            bundled_digest(),
            PROTOCOL_VERSION
        ),
        InstallDecision::Install | InstallDecision::Repair
    )
}

/// Runs one helper update and publishes its progress and result. Returns true when the
/// connection must stop until the headset is paired again.
async fn maintain(state: &mut State, pairing: &Pairing, notice: &mut Option<Instant>) -> bool {
    state.maintenance = Some(Maintenance::Updating);
    publish(state).await;
    state.maintenance = match maintenance::update(pairing).await {
        UpdateOutcome::Updated { version } => {
            state.update_available = false;
            *notice = Some(Instant::now() + UPDATED_NOTICE);
            Some(Maintenance::Updated { version })
        }
        UpdateOutcome::Unchanged => None,
        UpdateOutcome::NeedsAppUpdate => {
            state.status = Status::NeedsAppUpdate;
            None
        }
        UpdateOutcome::Missing => {
            state.status = Status::HelperMissing;
            None
        }
        UpdateOutcome::Busy => Some(Maintenance::Busy),
        UpdateOutcome::Failed(reason) => Some(Maintenance::Failed { reason }),
        UpdateOutcome::HostKeyChanged => {
            state.status = Status::HostKeyChanged;
            None
        }
        UpdateOutcome::Rejected => {
            state.status = Status::PairingRemoved;
            None
        }
    };
    publish(state).await;
    matches!(
        state.status,
        Status::HostKeyChanged | Status::PairingRemoved
    )
}

/// Holds a connected socket until it closes, or returns true when an update is requested.
/// Clears the "updated" notice when its minute is up.
async fn hold_connected(
    socket: &mut Socket,
    update: &Notify,
    state: &mut State,
    notice: &mut Option<Instant>,
) -> bool {
    loop {
        match hold(socket, update, *notice).await {
            Wake::Closed => return false,
            Wake::Update => return true,
            Wake::NoticeExpired => {
                *notice = None;
                state.maintenance = None;
                publish(state).await;
            }
        }
    }
}

/// Returns why this helper cannot be used, if it cannot.
fn incompatibility(hello: &Hello, expected: &Identity) -> Option<Status> {
    if hello
        .identity
        .as_ref()
        .is_some_and(|identity| identity != expected)
    {
        return Some(Status::IdentityChanged);
    }
    if hello.info.protocol_min > PROTOCOL_VERSION {
        return Some(Status::NeedsAppUpdate);
    }
    if hello.info.protocol_max < PROTOCOL_VERSION {
        return Some(Status::HelperOutdated);
    }
    None
}

/// Connects once, and repairs what it can when the connection fails.
async fn attempt(pairing: &Pairing, shared: &Mutex<Pairing>) -> Attempt {
    let result = wss::connect(
        &pairing.access.address,
        pairing.port,
        &pairing.cert_pin,
        &pairing.id,
        &pairing.token,
    )
    .await;
    match result {
        Ok((socket, hello)) => Attempt::Connected(Box::new(socket), hello),
        Err(WssError::Unauthorized) => restore_token(pairing).await,
        Err(WssError::CertificateChanged(observed)) => repin(pairing, shared, &observed).await,
        Err(WssError::Unreachable) => match maintenance::recover(pairing).await {
            Recovery::Running => Attempt::Retry,
            Recovery::Missing => Attempt::Failed(Status::HelperMissing),
            Recovery::Down => Attempt::Failed(Status::Offline),
            Recovery::Unreachable => find_moved_helper(pairing, shared).await,
            // another host may use the old address now
            Recovery::HostKeyChanged => match find_moved_helper(pairing, shared).await {
                Attempt::Retry => Attempt::Retry,
                _ => Attempt::Failed(Status::HostKeyChanged),
            },
            Recovery::Rejected => Attempt::Failed(Status::PairingRemoved),
        },
        Err(WssError::Failed(message)) => {
            warn!("[SteamFrame] Helper connection failed: {message}");
            Attempt::Failed(Status::Offline)
        }
    }
}

/// A changed host key and a rejected key get their own status; anything else means offline.
fn ssh_failure(error: SshError) -> Attempt {
    match error {
        SshError::HostKeyChanged => Attempt::Failed(Status::HostKeyChanged),
        SshError::Rejected => Attempt::Failed(Status::PairingRemoved),
        _ => Attempt::Failed(Status::Offline),
    }
}

/// The helper no longer knows this PC's token, so write it again over SSH.
async fn restore_token(pairing: &Pairing) -> Attempt {
    let session = match ssh::connect(&pairing.access).await {
        Ok(session) => session,
        Err(error) => return ssh_failure(error),
    };
    let result = setup::provision(&session, &pairing.id, &pairing.token, &pairing.public_key).await;
    session.close().await;
    match result {
        Ok(_) => {
            info!("[SteamFrame] Restored this PC's helper token");
            Attempt::Retry
        }
        Err(ProvisionError::Ssh(error)) => ssh_failure(error),
        Err(ProvisionError::HelperMissing) => Attempt::Failed(Status::HelperMissing),
        Err(error) => {
            warn!("[SteamFrame] Could not restore this PC's helper token: {error:?}");
            Attempt::Failed(Status::Offline)
        }
    }
}

/// Trusts a new helper certificate only when the pinned SSH host shows that same certificate.
async fn repin(pairing: &Pairing, shared: &Mutex<Pairing>, observed: &str) -> Attempt {
    // read the helper certificate over the pinned SSH host
    let session = match ssh::connect(&pairing.access).await {
        Ok(session) => session,
        Err(error) => return ssh_failure(error),
    };
    let result = setup::provision(&session, &pairing.id, &pairing.token, &pairing.public_key).await;
    session.close().await;
    // trust it only if WSS saw the same one
    match result {
        Ok(provisioned) if provisioned.cert_pin == observed => {
            info!("[SteamFrame] Pinned the helper's new certificate");
            let mut pairing = shared.lock().await;
            pairing.cert_pin = provisioned.cert_pin;
            pairing.port = provisioned.port;
            Attempt::Retry
        }
        Ok(_) => {
            warn!("[SteamFrame] The helper certificate differs from the one the headset holds");
            Attempt::Failed(Status::Offline)
        }
        Err(ProvisionError::Ssh(error)) => ssh_failure(error),
        Err(_) => Attempt::Failed(Status::Offline),
    }
}

/// Looks for the headset at another address. A candidate counts only when its helper presents
/// the pinned certificate.
async fn find_moved_helper(pairing: &Pairing, shared: &Mutex<Pairing>) -> Attempt {
    // try every devkit service found at another address
    for candidate in discovery::discover(Duration::from_secs(2)).await {
        if candidate.address == pairing.access.address {
            continue;
        }
        let result = wss::connect(
            &candidate.address,
            pairing.port,
            &pairing.cert_pin,
            &pairing.id,
            &pairing.token,
        )
        .await;
        // a wrong token still proves the pinned certificate
        let verified = match result {
            Ok((socket, _)) => {
                wss::close(socket).await;
                true
            }
            Err(error) => error == WssError::Unauthorized,
        };
        // store the new address and retry there
        if verified {
            info!(
                "[SteamFrame] The paired headset moved to {}",
                candidate.address
            );
            shared.lock().await.access.address = candidate.address;
            return Attempt::Retry;
        }
    }
    Attempt::Failed(Status::Offline)
}

enum Wake {
    Closed,
    Update,
    NoticeExpired,
}

/// Keeps the connection open until the helper stops answering, an update is requested, or the
/// notice deadline passes.
async fn hold(socket: &mut Socket, update: &Notify, notice: Option<Instant>) -> Wake {
    // ping on a timer, give up after long silence
    let mut ticker = tokio::time::interval(PING_INTERVAL);
    let mut last_heard = Instant::now();
    let notice_expired = async {
        match notice {
            Some(deadline) => tokio::time::sleep_until(deadline.into()).await,
            None => std::future::pending().await,
        }
    };
    tokio::pin!(notice_expired);
    loop {
        tokio::select! {
            message = socket.next() => match message {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return Wake::Closed,
                Some(Ok(_)) => last_heard = Instant::now(),
            },
            _ = ticker.tick() => {
                if last_heard.elapsed() > SILENCE_LIMIT
                    || socket.send(Message::Ping(Vec::new().into())).await.is_err()
                {
                    return Wake::Closed;
                }
            }
            _ = update.notified() => return Wake::Update,
            _ = &mut notice_expired => return Wake::NoticeExpired,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::steam_frame::setup::HelperInfo;

    fn hello(identity: Option<Identity>, min: u32, max: u32) -> Hello {
        Hello {
            info: HelperInfo {
                version: "26.10.0".into(),
                protocol_min: min,
                protocol_max: max,
                digest: None,
            },
            identity,
        }
    }

    fn identity(serial: &str) -> Identity {
        Identity {
            serial: serial.into(),
            model: "Deckard DV2".into(),
            manufacturer: "Valve".into(),
        }
    }

    #[test]
    fn detects_unusable_helpers() {
        let expected = identity("FPTEST000001");
        assert_eq!(
            incompatibility(&hello(Some(expected.clone()), 1, 1), &expected),
            None
        );
        assert_eq!(incompatibility(&hello(None, 1, 1), &expected), None);
        assert_eq!(
            incompatibility(&hello(Some(identity("FPTEST000002")), 1, 1), &expected),
            Some(Status::IdentityChanged)
        );
        assert_eq!(
            incompatibility(&hello(Some(expected.clone()), 2, 3), &expected),
            Some(Status::NeedsAppUpdate)
        );
        assert_eq!(
            incompatibility(&hello(Some(expected.clone()), 0, 0), &expected),
            Some(Status::HelperOutdated)
        );
    }
}
