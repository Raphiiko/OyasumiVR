use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};

use futures_util::{SinkExt, StreamExt};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use tokio::{sync::Mutex, task::JoinHandle};
use tokio_tungstenite::tungstenite::Message;

use super::{
    discovery,
    setup::{self, ProvisionError},
    ssh::{self, SshError},
    valid_pc_id,
    wss::{self, Hello, Socket, WssError},
    Access, Identity, PROTOCOL_VERSION,
};
use crate::utils::{get_time, send_event};

const EVENT: &str = "FRAME_CONNECTION_STATE";
const PING_INTERVAL: Duration = Duration::from_secs(15);
const SILENCE_LIMIT: Duration = Duration::from_secs(40);
const MAX_BACKOFF: Duration = Duration::from_secs(60);

/// A completed pairing, as the UI stores it.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    pub id: String,
    pub access: Access,
    pub port: u16,
    pub cert_pin: String,
    pub token: String,
    pub public_key: String,
    pub identity: Identity,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Connecting,
    Connected,
    Offline,
    IdentityChanged,
    NeedsAppUpdate,
    HelperOutdated,
    HostKeyChanged,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub pairing_id: String,
    pub status: Status,
    /// Milliseconds since the epoch of the last authenticated contact in this session.
    pub last_seen: Option<u64>,
    pub helper_version: Option<String>,
    /// The address and certificate this PC now trusts, which may differ from the stored ones.
    pub address: String,
    pub cert_pin: String,
}

struct Connection {
    pairing: Arc<Mutex<Pairing>>,
    task: JoinHandle<()>,
}

static CONNECTIONS: LazyLock<Mutex<HashMap<String, Connection>>> = LazyLock::new(Default::default);
static STATES: LazyLock<Mutex<HashMap<String, State>>> = LazyLock::new(Default::default);

/// Keeps one connection per pairing. A pairing whose settings are unchanged keeps its connection.
pub async fn set_pairings(pairings: Vec<Pairing>) {
    let mut connections = CONNECTIONS.lock().await;
    let mut kept = HashMap::new();
    for pairing in pairings {
        if !valid_pc_id(&pairing.id) {
            warn!("[Frame] Ignored a pairing with an invalid id");
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
        let task = tokio::spawn(run(shared.clone()));
        kept.insert(
            id,
            Connection {
                pairing: shared,
                task,
            },
        );
    }
    for (id, connection) in connections.drain() {
        connection.task.abort();
        STATES.lock().await.remove(&id);
    }
    *connections = kept;
}

pub async fn states() -> Vec<State> {
    STATES.lock().await.values().cloned().collect()
}

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

async fn run(shared: Arc<Mutex<Pairing>>) {
    let initial = shared.lock().await.clone();
    let mut state = State {
        pairing_id: initial.id.clone(),
        status: Status::Connecting,
        last_seen: None,
        helper_version: None,
        address: initial.access.address.clone(),
        cert_pin: initial.cert_pin.clone(),
    };
    publish(&state).await;
    let mut backoff = Duration::from_secs(2);
    let mut retries = 0;
    loop {
        let pairing = shared.lock().await.clone();
        let result = match attempt(&pairing, &shared).await {
            Attempt::Retry if retries >= 2 => Attempt::Failed(Status::Offline),
            result => result,
        };
        match result {
            Attempt::Connected(socket, hello) => {
                let pairing = shared.lock().await.clone();
                state.address = pairing.access.address;
                state.cert_pin = pairing.cert_pin;
                if let Some(status) = incompatibility(&hello, &pairing.identity) {
                    wss::close(*socket).await;
                    if state.status != status {
                        warn!(
                            "[Frame] Helper is unusable ({status:?}): it reports headset {:?} and protocols {}-{}, the pairing expects {:?} and protocol {PROTOCOL_VERSION}",
                            hello.identity, hello.info.protocol_min, hello.info.protocol_max, pairing.identity
                        );
                    }
                    state.status = status;
                    publish(&state).await;
                } else {
                    state.status = Status::Connected;
                    state.helper_version = Some(hello.info.version.clone());
                    state.last_seen = Some(get_time() as u64);
                    publish(&state).await;
                    backoff = Duration::from_secs(2);
                    retries = 0;
                    hold(*socket).await;
                    state.last_seen = Some(get_time() as u64);
                    state.status = Status::Offline;
                    publish(&state).await;
                    continue;
                }
            }
            Attempt::Retry => {
                retries += 1;
                continue;
            }
            Attempt::Failed(status) => {
                let pairing = shared.lock().await.clone();
                state.address = pairing.access.address;
                state.cert_pin = pairing.cert_pin;
                if state.status != status {
                    state.status = status;
                    publish(&state).await;
                }
                if status == Status::HostKeyChanged {
                    warn!("[Frame] The headset's SSH host key differs from the pinned one, so the connection stops until it is paired again");
                    return;
                }
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
        retries = 0;
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
        Err(WssError::Unreachable) => find_moved_helper(pairing, shared).await,
        Err(WssError::Failed(message)) => {
            warn!("[Frame] Helper connection failed: {message}");
            Attempt::Failed(Status::Offline)
        }
    }
}

fn ssh_failure(error: SshError) -> Attempt {
    match error {
        SshError::HostKeyChanged => Attempt::Failed(Status::HostKeyChanged),
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
            info!("[Frame] Restored this PC's helper token");
            Attempt::Retry
        }
        Err(ProvisionError::Ssh(error)) => ssh_failure(error),
        Err(error) => {
            warn!("[Frame] Could not restore this PC's helper token: {error:?}");
            Attempt::Failed(Status::Offline)
        }
    }
}

/// Trusts a new helper certificate only when the pinned SSH host shows that same certificate.
async fn repin(pairing: &Pairing, shared: &Mutex<Pairing>, observed: &str) -> Attempt {
    let session = match ssh::connect(&pairing.access).await {
        Ok(session) => session,
        Err(error) => return ssh_failure(error),
    };
    let result = setup::provision(&session, &pairing.id, &pairing.token, &pairing.public_key).await;
    session.close().await;
    match result {
        Ok(provisioned) if provisioned.cert_pin == observed => {
            info!("[Frame] Pinned the helper's new certificate");
            let mut pairing = shared.lock().await;
            pairing.cert_pin = provisioned.cert_pin;
            pairing.port = provisioned.port;
            Attempt::Retry
        }
        Ok(_) => {
            warn!("[Frame] The helper certificate differs from the one the headset holds");
            Attempt::Failed(Status::Offline)
        }
        Err(ProvisionError::Ssh(error)) => ssh_failure(error),
        Err(_) => Attempt::Failed(Status::Offline),
    }
}

/// Looks for the headset at another address. A candidate counts only when its helper presents
/// the pinned certificate.
async fn find_moved_helper(pairing: &Pairing, shared: &Mutex<Pairing>) -> Attempt {
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
        let verified = match result {
            Ok((socket, _)) => {
                wss::close(socket).await;
                true
            }
            Err(error) => error == WssError::Unauthorized,
        };
        if verified {
            info!("[Frame] The paired headset moved to {}", candidate.address);
            shared.lock().await.access.address = candidate.address;
            return Attempt::Retry;
        }
    }
    Attempt::Failed(Status::Offline)
}

/// Keeps the connection open until the helper stops answering.
async fn hold(mut socket: Socket) {
    let mut ticker = tokio::time::interval(PING_INTERVAL);
    let mut last_heard = Instant::now();
    loop {
        tokio::select! {
            message = socket.next() => match message {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                Some(Ok(_)) => last_heard = Instant::now(),
            },
            _ = ticker.tick() => {
                if last_heard.elapsed() > SILENCE_LIMIT
                    || socket.send(Message::Ping(Vec::new().into())).await.is_err()
                {
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::setup::HelperInfo;

    fn hello(identity: Option<Identity>, min: u32, max: u32) -> Hello {
        Hello {
            info: HelperInfo {
                version: "26.10.0".into(),
                protocol_min: min,
                protocol_max: max,
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
