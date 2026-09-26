use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex as StdMutex},
    time::{Duration, Instant},
};

use futures_util::{SinkExt, StreamExt};
use log::{info, warn};
use serde::Deserialize;
use tokio::{
    sync::{mpsc, oneshot, Mutex, Notify},
    task::JoinHandle,
};
use tokio_tungstenite::tungstenite::Message;

use super::{
    discovery,
    maintenance::{self, Recovery, UpdateOutcome},
    models::{Brightness, Identity, Maintenance, Pairing, SetBrightnessError, State, Status},
    setup::{
        self, bundled_digest, install_decision, InstallDecision, ProvisionError, BUNDLED_VERSION,
    },
    ssh::SshError,
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
const BRIGHTNESS_TIMEOUT: Duration = Duration::from_secs(5);

type BrightnessReply = oneshot::Sender<Result<f64, SetBrightnessError>>;
/// Holds a sender only while the connection is open, so a command never waits for a reconnect.
type BrightnessSlot = Arc<StdMutex<Option<mpsc::Sender<(f64, BrightnessReply)>>>>;

struct Connection {
    pairing: Arc<Mutex<Pairing>>,
    task: JoinHandle<()>,
    update: Arc<Notify>,
    brightness: BrightnessSlot,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum HelperMessage {
    Brightness(Brightness),
    SetBrightnessResult {
        id: u64,
        percentage: Option<f64>,
        error: Option<SetBrightnessError>,
    },
}

/// The running task per pairing id, with the pairing it shares and updates.
static CONNECTIONS: LazyLock<Mutex<HashMap<String, Connection>>> = LazyLock::new(Default::default);
/// The last published state per pairing id, removed when its pairing goes.
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
        let brightness = BrightnessSlot::default();
        let task = tokio::spawn(run(shared.clone(), update.clone(), brightness.clone()));
        let replaced = kept.insert(
            id,
            Connection {
                pairing: shared,
                task,
                update,
                brightness,
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

/// Starts a helper update for this pairing. Returns false for an unknown or stopped pairing.
pub async fn request_update(pairing_id: &str) -> bool {
    let connections = CONNECTIONS.lock().await;
    let Some(connection) = connections
        .get(pairing_id)
        .filter(|connection| !connection.task.is_finished())
    else {
        return false;
    };
    connection.update.notify_one();
    true
}

/// Sets the headset's hardware brightness and returns the value the helper applied.
pub async fn set_brightness(pairing_id: &str, percentage: f64) -> Result<f64, SetBrightnessError> {
    let sender = CONNECTIONS
        .lock()
        .await
        .get(pairing_id)
        .and_then(|connection| connection.brightness.lock().unwrap().clone())
        .ok_or(SetBrightnessError::Offline)?;
    let (reply, result) = oneshot::channel();
    sender
        .send((percentage, reply))
        .await
        .map_err(|_| SetBrightnessError::Offline)?;
    match tokio::time::timeout(BRIGHTNESS_TIMEOUT, result).await {
        Ok(Ok(result)) => result,
        _ => Err(SetBrightnessError::Offline),
    }
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
async fn run(shared: Arc<Mutex<Pairing>>, update: Arc<Notify>, brightness: BrightnessSlot) {
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
        brightness: None,
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
                    // the helper answered, so a problem status from an earlier attempt is stale
                    state.status = Status::Connecting;
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
                        hold_connected(&mut socket, &update, &brightness, &mut state, &mut notice)
                            .await;
                    wss::close(*socket).await;
                    state.brightness = None;
                    state.last_seen = Some(get_time() as u64);
                    if requested {
                        if maintain(&mut state, &pairing, &mut notice).await {
                            return;
                        }
                    } else {
                        drop_updated_notice(&mut state, &mut notice);
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
                let dropped = drop_updated_notice(&mut state, &mut notice);
                if state.status != status || dropped {
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

/// Clears an "updated" notice, which only shows while connected. Returns whether one was set.
fn drop_updated_notice(state: &mut State, notice: &mut Option<Instant>) -> bool {
    if !matches!(state.maintenance, Some(Maintenance::Updated { .. })) {
        return false;
    }
    state.maintenance = None;
    *notice = None;
    true
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
/// Relays brightness meanwhile, and clears the "updated" notice when its minute is up.
async fn hold_connected(
    socket: &mut Socket,
    update: &Notify,
    brightness: &BrightnessSlot,
    state: &mut State,
    notice: &mut Option<Instant>,
) -> bool {
    let (sender, requests) = mpsc::channel(16);
    *brightness.lock().unwrap() = Some(sender);
    let mut relay = Relay {
        requests,
        pending: HashMap::new(),
        next_id: 0,
    };
    let requested = loop {
        match hold(socket, update, *notice, &mut relay, state).await {
            Wake::Closed => break false,
            Wake::Update => break true,
            Wake::NoticeExpired => {
                *notice = None;
                state.maintenance = None;
                publish(state).await;
            }
        }
    };
    // dropping the relay answers every waiting command with Offline
    *brightness.lock().unwrap() = None;
    requested
}

/// Brightness commands on one open connection.
struct Relay {
    requests: mpsc::Receiver<(f64, BrightnessReply)>,
    /// Commands sent to the helper and not answered yet, by message id.
    pending: HashMap<u64, BrightnessReply>,
    next_id: u64,
}

/// Applies one helper message: a brightness report, or the answer to a command.
async fn receive(text: &str, relay: &mut Relay, state: &mut State) {
    match serde_json::from_str(text) {
        Ok(HelperMessage::Brightness(brightness)) => {
            state.brightness = Some(brightness);
            publish(state).await;
        }
        Ok(HelperMessage::SetBrightnessResult {
            id,
            percentage,
            error,
        }) => {
            if let Some(reply) = relay.pending.remove(&id) {
                let error = error.unwrap_or(SetBrightnessError::WriteFailed);
                let _ = reply.send(percentage.ok_or(error));
            }
        }
        Err(_) => {}
    }
}

/// Returns why this helper cannot be used, if it cannot.
fn incompatibility(hello: &Hello, expected: &Identity) -> Option<Status> {
    if hello
        .identity
        .as_ref()
        .is_some_and(|identity| !identity.same_headset(expected))
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
    // write the token file again over SSH
    let session = match setup::open(&pairing.access, &pairing.id, &pairing.public_key).await {
        Ok(session) => session,
        Err(error) => return ssh_failure(error),
    };
    let result = setup::provision(&session, &pairing.id, &pairing.token, &pairing.public_key).await;
    session.close().await;

    // retry at once when it worked
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
    let session = match setup::open(&pairing.access, &pairing.id, &pairing.public_key).await {
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
async fn hold(
    socket: &mut Socket,
    update: &Notify,
    notice: Option<Instant>,
    relay: &mut Relay,
    state: &mut State,
) -> Wake {
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
                Some(Ok(message)) => {
                    last_heard = Instant::now();
                    if let Message::Text(text) = message {
                        receive(&text, relay, state).await;
                    }
                }
            },
            Some((percentage, reply)) = relay.requests.recv() => {
                relay.next_id += 1;
                let command = serde_json::json!({
                    "type": "setBrightness",
                    "id": relay.next_id,
                    "percentage": percentage,
                });
                if socket.send(Message::text(command.to_string())).await.is_err() {
                    return Wake::Closed;
                }
                relay.pending.insert(relay.next_id, reply);
            }
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

    #[test]
    fn reads_the_helper_brightness_messages() {
        let parse = |text: &str| serde_json::from_str::<HelperMessage>(text).unwrap();
        let HelperMessage::Brightness(full) = parse(
            r#"{"type":"brightness","runtime":true,"supported":true,"min":9.0,"max":125.0,"percentage":100.0}"#,
        ) else {
            panic!("not a brightness report");
        };
        assert_eq!(
            full,
            Brightness {
                runtime: true,
                supported: true,
                min: Some(9.0),
                max: Some(125.0),
                percentage: Some(100.0),
            }
        );
        let HelperMessage::Brightness(unavailable) =
            parse(r#"{"type":"brightness","runtime":false,"supported":false}"#)
        else {
            panic!("not a brightness report");
        };
        assert_eq!(unavailable.percentage, None);
        assert!(matches!(
            parse(r#"{"type":"setBrightnessResult","id":7,"percentage":125.0}"#),
            HelperMessage::SetBrightnessResult {
                id: 7,
                percentage: Some(125.0),
                error: None
            }
        ));
        assert!(matches!(
            parse(r#"{"type":"setBrightnessResult","id":8,"error":"runtimeUnavailable"}"#),
            HelperMessage::SetBrightnessResult {
                id: 8,
                percentage: None,
                error: Some(SetBrightnessError::RuntimeUnavailable)
            }
        ));
    }
}
