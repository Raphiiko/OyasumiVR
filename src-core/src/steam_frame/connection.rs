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
    models::{
        Brightness, Cct, Control, FadeEnded, FadeError, FadeOutcome, FadeRequest, Maintenance,
        Pairing, SetBrightnessError, SetCctError, State, Status,
    },
    setup::{
        self, bundled_digest, install_decision, InstallDecision, ProvisionError, BUNDLED_VERSION,
    },
    ssh::{self, SshError},
    valid_pc_id,
    wss::{self, Hello, Socket, WssError},
    PROTOCOL_VERSION,
};
use crate::utils::send_event;

const EVENT: &str = "STEAM_FRAME_CONNECTION_STATE";
const FADE_ENDED_EVENT: &str = "STEAM_FRAME_FADE_ENDED";
const PING_INTERVAL: Duration = Duration::from_secs(15);
const SILENCE_LIMIT: Duration = Duration::from_secs(40);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

type BrightnessReply = oneshot::Sender<Result<f64, SetBrightnessError>>;
type CctReply = oneshot::Sender<Result<Cct, SetCctError>>;
type FadeReply = oneshot::Sender<Result<(), FadeError>>;
/// Holds a sender only while the connection is open, so a command never waits for a reconnect.
type CommandSlot = Arc<StdMutex<Option<mpsc::Sender<Command>>>>;

/// A command for the helper, with where its answer goes.
enum Command {
    SetBrightness(f64, BrightnessReply),
    SetCct(u32, CctReply),
    Fade(FadeRequest, FadeReply),
    CancelFade(String),
}

enum Reply {
    Brightness(BrightnessReply),
    Cct(CctReply),
    Fade(FadeReply),
}

struct Connection {
    pairing: Arc<Mutex<Pairing>>,
    task: JoinHandle<()>,
    update: Arc<Notify>,
    commands: CommandSlot,
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
    Cct(Cct),
    SetCctResult {
        id: u64,
        snapshot: Option<Cct>,
        error: Option<SetCctError>,
    },
    FadeResult {
        id: u64,
        error: Option<FadeError>,
    },
    FadeEnded {
        control: Control,
        operation: String,
        outcome: FadeOutcome,
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
        let commands = CommandSlot::default();
        let task = tokio::spawn(run(shared.clone(), update.clone(), commands.clone()));
        let replaced = kept.insert(
            id,
            Connection {
                pairing: shared,
                task,
                update,
                commands,
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
    let command = |reply| Command::SetBrightness(percentage, reply);
    send(pairing_id, command, SetBrightnessError::Offline).await
}

/// Sets the headset's color temperature and returns the snapshot the helper applied.
pub async fn set_cct(pairing_id: &str, kelvin: u32) -> Result<Cct, SetCctError> {
    let command = |reply| Command::SetCct(kelvin, reply);
    send(pairing_id, command, SetCctError::Offline).await
}

/// Starts a fade on the helper. `Ok` means the helper accepted it; the outcome arrives as a
/// `STEAM_FRAME_FADE_ENDED` event.
pub async fn fade(pairing_id: &str, request: FadeRequest) -> Result<(), FadeError> {
    let command = |reply| Command::Fade(request, reply);
    send(pairing_id, command, FadeError::Offline).await
}

/// Cancels a fade by its operation ID. The helper ignores an ID it does not run.
pub async fn cancel_fade(pairing_id: &str, operation: String) {
    if let Some(sender) = sender(pairing_id).await {
        let _ = sender.send(Command::CancelFade(operation)).await;
    }
}

async fn sender(pairing_id: &str) -> Option<mpsc::Sender<Command>> {
    CONNECTIONS
        .lock()
        .await
        .get(pairing_id)
        .and_then(|connection| connection.commands.lock().unwrap().clone())
}

/// Sends a command on the open connection and waits for its answer, or `offline` without one.
async fn send<T, E: Copy>(
    pairing_id: &str,
    command: impl FnOnce(oneshot::Sender<Result<T, E>>) -> Command,
    offline: E,
) -> Result<T, E> {
    let sender = sender(pairing_id).await.ok_or(offline)?;
    let (reply, result) = oneshot::channel();
    let exchange = async {
        sender.send(command(reply)).await.map_err(|_| offline)?;
        result.await.map_err(|_| offline)?
    };
    tokio::time::timeout(COMMAND_TIMEOUT, exchange)
        .await
        .unwrap_or(Err(offline))
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
async fn run(shared: Arc<Mutex<Pairing>>, update: Arc<Notify>, commands: CommandSlot) {
    // announce that this pairing is connecting
    let initial = shared.lock().await.clone();
    let mut state = State {
        pairing_id: initial.id.clone(),
        status: Status::Connecting,
        helper_version: None,
        update_available: false,
        maintenance: None,
        address: initial.access.address.clone(),
        cert_pin: initial.cert_pin.clone(),
        brightness: None,
        cct: None,
    };
    publish(&state).await;
    let mut backoff = Duration::from_secs(2);
    let mut retries = 0;
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
                settle_maintenance(&mut state, &hello);

                // update an older helper, once per app start
                if state.update_available && maintenance::take_automatic_attempt(&pairing.id).await
                {
                    wss::close(*socket).await;
                    // the helper answered, so a problem status from an earlier attempt is stale
                    state.status = Status::Connecting;
                    if maintain(&mut state, &pairing).await {
                        return;
                    }
                    continue;
                }

                // refuse an unusable helper, else hold the socket
                if let Some(status) = incompatibility(&hello) {
                    wss::close(*socket).await;
                    if state.status != status {
                        warn!(
                            "[SteamFrame] Helper is unusable ({status:?}): it speaks protocols {}-{}, this app speaks protocol {PROTOCOL_VERSION}",
                            hello.info.protocol_min, hello.info.protocol_max
                        );
                    }
                    state.status = status;
                    publish(&state).await;
                } else {
                    state.status = Status::Connected;
                    publish(&state).await;
                    backoff = Duration::from_secs(2);
                    retries = 0;
                    let requested =
                        hold_connected(&mut socket, &update, &commands, &mut state).await;
                    wss::close(*socket).await;
                    state.brightness = None;
                    state.cct = None;
                    if requested {
                        if maintain(&mut state, &pairing).await {
                            return;
                        }
                        continue;
                    }
                    state.status = Status::Offline;
                    publish(&state).await;
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
                if maintain(&mut state, &pairing).await {
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

/// Clears a failed notice once no update is needed, and an updated notice once the helper version
/// changed.
fn settle_maintenance(state: &mut State, hello: &Hello) {
    let settled = match &state.maintenance {
        Some(Maintenance::Failed) => !state.update_available,
        Some(Maintenance::Updated { version }) => *version != hello.info.version,
        _ => false,
    };
    if settled {
        state.maintenance = None;
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
async fn maintain(state: &mut State, pairing: &Pairing) -> bool {
    state.maintenance = Some(Maintenance::Updating);
    publish(state).await;
    state.maintenance = match maintenance::update(pairing).await {
        UpdateOutcome::Updated { version } => {
            state.update_available = false;
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
        UpdateOutcome::Failed(reason) => {
            warn!("[SteamFrame] Helper update failed: {reason:?}");
            Some(Maintenance::Failed)
        }
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
/// Relays brightness, color temperature, and fades meanwhile.
async fn hold_connected(
    socket: &mut Socket,
    update: &Notify,
    commands: &CommandSlot,
    state: &mut State,
) -> bool {
    let (sender, requests) = mpsc::channel(16);
    *commands.lock().unwrap() = Some(sender);
    let mut relay = Relay {
        requests,
        pending: HashMap::new(),
        next_id: 0,
    };
    let requested = matches!(hold(socket, update, &mut relay, state).await, Wake::Update);
    // dropping the relay answers every waiting command with Offline
    *commands.lock().unwrap() = None;
    requested
}

/// Helper commands on one open connection.
struct Relay {
    requests: mpsc::Receiver<Command>,
    /// Commands sent to the helper and not answered yet, by message id.
    pending: HashMap<u64, Reply>,
    next_id: u64,
}

/// Applies one helper message: a brightness or color temperature report, or the answer to a
/// command.
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
            // the helper sends this PC no snapshot for its own write, so record the value here
            if let (Some(applied), Some(brightness)) = (percentage, state.brightness.as_mut()) {
                if brightness.percentage != Some(applied) {
                    brightness.percentage = Some(applied);
                    publish(state).await;
                }
            }
            if let Some(Reply::Brightness(reply)) = relay.pending.remove(&id) {
                let error = error.unwrap_or(SetBrightnessError::WriteFailed);
                let _ = reply.send(percentage.ok_or(error));
            }
        }
        Ok(HelperMessage::Cct(cct)) => {
            state.cct = Some(cct);
            publish(state).await;
        }
        Ok(HelperMessage::SetCctResult {
            id,
            snapshot,
            error,
        }) => {
            // as for brightness, the reply is this PC's only report of its own write
            if let Some(applied) = snapshot.as_ref().filter(|s| state.cct.as_ref() != Some(s)) {
                state.cct = Some(applied.clone());
                publish(state).await;
            }
            if let Some(Reply::Cct(reply)) = relay.pending.remove(&id) {
                let error = error.unwrap_or(SetCctError::WriteFailed);
                let _ = reply.send(snapshot.ok_or(error));
            }
        }
        Ok(HelperMessage::FadeResult { id, error }) => {
            if let Some(Reply::Fade(reply)) = relay.pending.remove(&id) {
                let _ = reply.send(error.map_or(Ok(()), Err));
            }
        }
        Ok(HelperMessage::FadeEnded {
            control,
            operation,
            outcome,
        }) => {
            let ended = FadeEnded {
                pairing_id: state.pairing_id.clone(),
                control,
                operation,
                outcome,
            };
            send_event(FADE_ENDED_EVENT, ended).await;
        }
        Err(_) => {}
    }
}

/// Returns why this helper cannot be used, if it cannot.
fn incompatibility(hello: &Hello) -> Option<Status> {
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
    let session = match ssh::connect(&pairing.access).await {
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
}

/// Keeps the connection open until the helper stops answering or an update is requested.
async fn hold(socket: &mut Socket, update: &Notify, relay: &mut Relay, state: &mut State) -> Wake {
    // ping on a timer, give up after long silence
    let mut ticker = tokio::time::interval(PING_INTERVAL);
    let mut last_heard = Instant::now();
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
            Some(command) = relay.requests.recv() => {
                relay.next_id += 1;
                let id = relay.next_id;
                let (message, reply) = match command {
                    Command::SetBrightness(percentage, reply) => (
                        serde_json::json!({"type": "setBrightness", "id": id, "percentage": percentage}),
                        Reply::Brightness(reply),
                    ),
                    Command::SetCct(kelvin, reply) => (
                        serde_json::json!({"type": "setCct", "id": id, "kelvin": kelvin}),
                        Reply::Cct(reply),
                    ),
                    Command::Fade(request, reply) => (
                        serde_json::json!({
                            "type": "fade",
                            "id": id,
                            "control": request.control,
                            "operation": request.operation,
                            "target": request.target,
                            "durationMs": request.duration_ms,
                            "simple": request.simple,
                        }),
                        Reply::Fade(reply),
                    ),
                    Command::CancelFade(operation) => {
                        let message = serde_json::json!({"type": "cancelFade", "operation": operation});
                        if socket.send(Message::text(message.to_string())).await.is_err() {
                            return Wake::Closed;
                        }
                        continue;
                    }
                };
                if socket.send(Message::text(message.to_string())).await.is_err() {
                    return Wake::Closed;
                }
                relay.pending.insert(id, reply);
            }
            _ = ticker.tick() => {
                if last_heard.elapsed() > SILENCE_LIMIT
                    || socket.send(Message::Ping(Vec::new().into())).await.is_err()
                {
                    return Wake::Closed;
                }
            }
            _ = update.notified() => return Wake::Update,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::steam_frame::setup::HelperInfo;

    fn hello(min: u32, max: u32) -> Hello {
        Hello {
            info: HelperInfo {
                version: "26.10.0".into(),
                protocol_min: min,
                protocol_max: max,
                digest: None,
            },
        }
    }

    #[test]
    fn detects_unusable_helpers() {
        assert_eq!(incompatibility(&hello(1, 1)), None);
        assert_eq!(incompatibility(&hello(2, 3)), Some(Status::NeedsAppUpdate));
        assert_eq!(incompatibility(&hello(0, 0)), Some(Status::HelperOutdated));
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

    #[test]
    fn reads_the_helper_cct_messages() {
        let parse = |text: &str| serde_json::from_str::<HelperMessage>(text).unwrap();
        let off_curve = Cct {
            available: true,
            kelvin: Some(2313),
            exact: Some(false),
        };
        let HelperMessage::Cct(report) =
            parse(r#"{"type":"cct","available":true,"kelvin":2313,"exact":false}"#)
        else {
            panic!("not a cct report");
        };
        assert_eq!(report, off_curve);
        let HelperMessage::Cct(unavailable) = parse(r#"{"type":"cct","available":false}"#) else {
            panic!("not a cct report");
        };
        assert_eq!(unavailable.kelvin, None);
        let HelperMessage::SetCctResult {
            id,
            snapshot,
            error,
        } = parse(
            r#"{"type":"setCctResult","id":3,"snapshot":{"available":true,"kelvin":2313,"exact":false}}"#,
        )
        else {
            panic!("not a cct reply");
        };
        assert_eq!((id, snapshot, error), (3, Some(off_curve), None));
        assert!(matches!(
            parse(r#"{"type":"setCctResult","id":4,"error":"writeFailed"}"#),
            HelperMessage::SetCctResult {
                id: 4,
                snapshot: None,
                error: Some(SetCctError::WriteFailed)
            }
        ));
    }

    #[test]
    fn reads_the_helper_fade_messages() {
        let parse = |text: &str| serde_json::from_str::<HelperMessage>(text).unwrap();
        assert!(matches!(
            parse(r#"{"type":"fadeResult","id":2}"#),
            HelperMessage::FadeResult { id: 2, error: None }
        ));
        assert!(matches!(
            parse(r#"{"type":"fadeResult","id":3,"error":"writeFailed"}"#),
            HelperMessage::FadeResult {
                id: 3,
                error: Some(FadeError::WriteFailed)
            }
        ));
        let HelperMessage::FadeEnded {
            control,
            operation,
            outcome,
        } = parse(
            r#"{"type":"fadeEnded","control":"cct","operation":"f2","outcome":"externalChange"}"#,
        )
        else {
            panic!("not a fade outcome");
        };
        assert_eq!(
            (control, operation.as_str(), outcome),
            (Control::Cct, "f2", FadeOutcome::ExternalChange)
        );
    }
}
