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
        Brightness, Cct, Control, FadeEnded, FadeError, FadeOutcome, FadeRequest, Identity,
        Maintenance, Pairing, SetBrightnessError, SetCctError, State, Status,
    },
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
const FADE_ENDED_EVENT: &str = "STEAM_FRAME_FADE_ENDED";
const PING_INTERVAL: Duration = Duration::from_secs(15);
const SILENCE_LIMIT: Duration = Duration::from_secs(40);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
const UPDATED_NOTICE: Duration = Duration::from_secs(60);
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
    BeginMaintenanceResult {
        id: u64,
        held: bool,
    },
    Maintenance {
        held: bool,
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
        last_seen: None,
        helper_version: None,
        update_available: false,
        maintenance: None,
        address: initial.access.address.clone(),
        cert_pin: initial.cert_pin.clone(),
        brightness: None,
        cct: None,
        fades: false,
        hold: false,
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

                // update an older helper, once per app start; a helper that runs fades waits for
                // them while connected
                let incompatible = incompatibility(&hello, &pairing.identity);
                let automatic = state.update_available
                    && incompatible != Some(Status::IdentityChanged)
                    && maintenance::take_automatic_attempt(&pairing.id).await;
                if automatic && (!hello.fades || incompatible.is_some()) {
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
                    state.fades = hello.fades;
                    publish(&state).await;
                    backoff = Duration::from_secs(2);
                    retries = 0;
                    let held = hold_connected(
                        &mut socket,
                        &update,
                        &commands,
                        &mut state,
                        &mut notice,
                        automatic,
                    )
                    .await;
                    state.brightness = None;
                    state.cct = None;
                    state.fades = false;
                    state.hold = false;
                    state.last_seen = Some(get_time() as u64);
                    match held {
                        Held::Update => {
                            let stop = maintain(&mut state, &pairing, &mut notice).await;
                            // a restarted helper dropped the hold already; any other one keeps it
                            let end = serde_json::json!({"type": "endMaintenance"});
                            let _ = socket.send(Message::text(end.to_string())).await;
                            wss::close(*socket).await;
                            if stop {
                                return;
                            }
                        }
                        Held::Closed { update_waiting } => {
                            wss::close(*socket).await;
                            // the next connection runs the waiting update as its automatic one
                            if update_waiting {
                                maintenance::release_automatic_attempt(&pairing.id).await;
                            }
                            drop_updated_notice(&mut state, &mut notice);
                            if state.maintenance == Some(Maintenance::Waiting) {
                                state.maintenance = None;
                            }
                            state.status = Status::Offline;
                            publish(&state).await;
                        }
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

enum Held {
    /// Run the update now. A helper that runs fades refuses new ones until it restarts.
    Update,
    Closed {
        update_waiting: bool,
    },
}

/// Holds a connected socket until it closes or an update can start. Relays brightness and color
/// temperature meanwhile, and clears the "updated" notice when its minute is up. `update_wanted`
/// starts an update as soon as no fade runs.
async fn hold_connected(
    socket: &mut Socket,
    update: &Notify,
    commands: &CommandSlot,
    state: &mut State,
    notice: &mut Option<Instant>,
    update_wanted: bool,
) -> Held {
    let (sender, requests) = mpsc::channel(16);
    *commands.lock().unwrap() = Some(sender);
    let mut relay = Relay {
        requests,
        pending: HashMap::new(),
        next_id: 0,
        update_wanted,
        hold_request: None,
        held: false,
    };
    let held = loop {
        match hold(socket, update, *notice, &mut relay, state).await {
            Wake::Closed => {
                break Held::Closed {
                    update_waiting: relay.update_wanted,
                }
            }
            Wake::Update => break Held::Update,
            Wake::NoticeExpired => {
                *notice = None;
                if state.maintenance != Some(Maintenance::Waiting) {
                    state.maintenance = None;
                    publish(state).await;
                }
            }
        }
    };
    // dropping the relay answers every waiting command with Offline
    *commands.lock().unwrap() = None;
    held
}

/// Helper commands on one open connection.
struct Relay {
    requests: mpsc::Receiver<Command>,
    /// Commands sent to the helper and not answered yet, by message id.
    pending: HashMap<u64, Reply>,
    next_id: u64,
    /// An update waits for the fades to end, and then for the helper's maintenance hold.
    update_wanted: bool,
    /// The id of the `beginMaintenance` sent and not answered yet.
    hold_request: Option<u64>,
    /// The helper granted the hold, so the update can start.
    held: bool,
}

/// A fade runs on the headset, from this PC or another one.
fn fading(state: &State) -> bool {
    let brightness = state.brightness.as_ref().is_some_and(|b| b.fade.is_some());
    brightness || state.cct.as_ref().is_some_and(|c| c.fade.is_some())
}

/// Applies one helper message: a brightness or color temperature report, or the answer to a
/// command.
async fn receive(text: &str, relay: &mut Relay, state: &mut State) {
    match serde_json::from_str(text) {
        Ok(HelperMessage::Brightness(mut brightness)) => {
            if let Some(fade) = brightness.fade.as_mut() {
                fade.ends_at = get_time() as u64 + fade.remaining_ms;
            }
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
        Ok(HelperMessage::Cct(mut cct)) => {
            if let Some(fade) = cct.fade.as_mut() {
                fade.ends_at = get_time() as u64 + fade.remaining_ms;
            }
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
        Ok(HelperMessage::BeginMaintenanceResult { id, held }) => {
            if relay.hold_request == Some(id) {
                relay.hold_request = None;
                relay.held = held;
            }
        }
        Ok(HelperMessage::Maintenance { held }) => {
            state.hold = held;
            publish(state).await;
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
        if relay.update_wanted {
            match request_hold(socket, relay, state).await {
                Ok(true) => return Wake::Update,
                Ok(false) => {}
                Err(()) => return Wake::Closed,
            }
        }
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
            _ = update.notified() => {
                if !state.fades {
                    return Wake::Update;
                }
                relay.update_wanted = true;
            }
            _ = &mut notice_expired => return Wake::NoticeExpired,
        }
    }
}

/// Moves a wanted update on: shows that it waits while a fade runs, and asks for the helper's
/// maintenance hold once none does. Returns true once the helper granted it.
async fn request_hold(
    socket: &mut Socket,
    relay: &mut Relay,
    state: &mut State,
) -> Result<bool, ()> {
    if relay.held {
        return Ok(true);
    }

    // show the wait while a fade runs
    let waiting = fading(state);
    if waiting != (state.maintenance == Some(Maintenance::Waiting)) {
        state.maintenance = waiting.then_some(Maintenance::Waiting);
        publish(state).await;
    }

    // ask for the hold once no fade runs and no other PC holds it
    if waiting || state.hold || relay.hold_request.is_some() {
        return Ok(false);
    }
    relay.next_id += 1;
    let message = serde_json::json!({"type": "beginMaintenance", "id": relay.next_id});
    socket
        .send(Message::text(message.to_string()))
        .await
        .map_err(drop)?;
    relay.hold_request = Some(relay.next_id);
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::steam_frame::{models::Fade, setup::HelperInfo};

    fn hello(identity: Option<Identity>, min: u32, max: u32) -> Hello {
        Hello {
            info: HelperInfo {
                version: "26.10.0".into(),
                protocol_min: min,
                protocol_max: max,
                digest: None,
            },
            identity,
            fades: false,
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
                fade: None,
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
            gains: Some([1.0, 0.6, 0.2]),
            kelvin: Some(2313),
            exact: Some(false),
            fade: None,
        };
        let HelperMessage::Cct(report) = parse(
            r#"{"type":"cct","available":true,"gains":[1.0,0.6,0.2],"kelvin":2313,"exact":false}"#,
        ) else {
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
            r#"{"type":"setCctResult","id":3,"snapshot":{"available":true,"gains":[1.0,0.6,0.2],"kelvin":2313,"exact":false}}"#,
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
        let HelperMessage::Brightness(report) = parse(
            r#"{"type":"brightness","runtime":true,"supported":true,"min":9.0,"max":125.0,"percentage":80.0,"fade":{"operation":"f1","target":30.0,"remainingMs":1500}}"#,
        ) else {
            panic!("not a brightness report");
        };
        assert_eq!(
            report.fade,
            Some(Fade {
                operation: "f1".into(),
                target: 30.0,
                remaining_ms: 1500,
                ends_at: 0,
            })
        );
        assert!(matches!(
            parse(r#"{"type":"fadeResult","id":2}"#),
            HelperMessage::FadeResult { id: 2, error: None }
        ));
        assert!(matches!(
            parse(r#"{"type":"fadeResult","id":3,"error":"maintenance"}"#),
            HelperMessage::FadeResult {
                id: 3,
                error: Some(FadeError::Maintenance)
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
        assert!(matches!(
            parse(r#"{"type":"beginMaintenanceResult","id":4,"held":false}"#),
            HelperMessage::BeginMaintenanceResult { id: 4, held: false }
        ));
        assert!(matches!(
            parse(r#"{"type":"maintenance","held":true}"#),
            HelperMessage::Maintenance { held: true }
        ));
    }

    #[test]
    fn a_fade_on_either_control_counts_as_fading() {
        let cct = |fade: Option<Fade>| Cct {
            available: true,
            gains: Some([1.0; 3]),
            kelvin: Some(6600),
            exact: Some(true),
            fade,
        };
        let fade = Fade {
            operation: "f1".into(),
            target: 3000.0,
            remaining_ms: 100,
            ends_at: 0,
        };
        let mut state = State {
            pairing_id: "p".into(),
            status: Status::Connected,
            last_seen: None,
            helper_version: None,
            update_available: true,
            maintenance: None,
            address: String::new(),
            cert_pin: String::new(),
            brightness: None,
            cct: Some(cct(None)),
            fades: true,
            hold: false,
        };
        assert!(!fading(&state));
        state.cct = Some(cct(Some(fade)));
        assert!(fading(&state));
    }
}
