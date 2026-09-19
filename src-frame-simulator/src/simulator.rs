use crate::contracts::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use http_body_util::{BodyExt, Full, Limited};
use hyper::{body::Bytes, service::service_fn, Request as HttpRequest, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use std::{
    io,
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    net::TcpListener,
    sync::{oneshot, watch, Semaphore},
    task::{JoinHandle, JoinSet},
    time::timeout,
};
use tokio_rustls::{
    rustls::{
        self,
        pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
    },
    TlsAcceptor,
};
use tokio_tungstenite::{
    accept_hdr_async_with_config,
    tungstenite::{
        handshake::server::{Request as UpgradeRequest, Response as UpgradeResponse},
        protocol::WebSocketConfig,
        Message,
    },
};

pub const CLIENT_TOKEN: &str = "DISPOSABLE-LOCAL-CLIENT-CREDENTIAL-ONLY";
pub const CONTROL_TOKEN: &str = "DISPOSABLE-LOCAL-OPERATOR-CREDENTIAL-ONLY";
pub const DAEMON_ID: &str = "synthetic-daemon-a";
pub const DEVICE_ID: &str = "synthetic-hmd-a";
pub const SERVER_CERT: &[u8] = include_bytes!("../fixtures/server.der");
pub const MAX_REGISTRATION_BYTES: usize = 65_535;
const SERVER_KEY: &[u8] = include_bytes!("../fixtures/server-key.der");

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Control {
    Arm { timeout_ms: u64 },
    Approve,
    Deny,
    Timeout,
    ApproveAndDrop,
    AppendDuplicates { enabled: bool },
    Scenario { name: String },
    Steamvr { ready: bool },
    Offline,
    Online,
    Disconnect,
    Reset,
}

enum Decision {
    Approved,
    Denied,
    TimedOut,
    Dropped,
}
struct Pending {
    id: u64,
    key: String,
    answer: oneshot::Sender<Decision>,
}

struct State {
    armed: Option<Duration>,
    pending: Option<Pending>,
    registrations: Vec<String>,
    authorized_keys: Vec<String>,
    append_duplicates: bool,
    device_id: String,
    build: String,
    protocol: Protocol,
    steamvr: SteamVrState,
    online: bool,
    discovery: String,
}

impl Default for State {
    fn default() -> Self {
        Self {
            armed: None,
            pending: None,
            registrations: vec![],
            authorized_keys: vec![],
            append_duplicates: false,
            device_id: DEVICE_ID.into(),
            build: "0.2.0-simulator".into(),
            protocol: PROTOCOL,
            steamvr: SteamVrState::Ready,
            online: true,
            discovery: "one".into(),
        }
    }
}

#[derive(Clone)]
pub struct Simulator {
    state: Arc<Mutex<State>>,
    disconnect: watch::Sender<u64>,
    controller: Arc<Semaphore>,
    next_request: Arc<AtomicU64>,
}

impl Default for Simulator {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(State::default())),
            disconnect: watch::channel(0).0,
            controller: Arc::new(Semaphore::new(1)),
            next_request: Arc::new(AtomicU64::new(0)),
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Snapshot {
    pub armed: bool,
    pub pending: bool,
    pub registrations: usize,
    pub authorized_keys: usize,
    pub append_duplicates: bool,
    pub online: bool,
}

impl Simulator {
    pub fn snapshot(&self) -> Snapshot {
        let s = self.state.lock().unwrap();
        Snapshot {
            armed: s.armed.is_some(),
            pending: s.pending.is_some(),
            registrations: s.registrations.len(),
            authorized_keys: s.authorized_keys.len(),
            append_duplicates: s.append_duplicates,
            online: s.online,
        }
    }

    pub fn registered(&self, key: &str) -> bool {
        self.state
            .lock()
            .unwrap()
            .authorized_keys
            .iter()
            .any(|k| k.split_whitespace().nth(1) == key.split_whitespace().nth(1))
    }

    pub fn control(&self, action: Control) -> Result<(), &'static str> {
        let mut s = self.state.lock().unwrap();
        match action {
            Control::Arm { timeout_ms } => {
                if s.pending.is_some() {
                    return Err("request already pending");
                }
                if !(1..=30_000).contains(&timeout_ms) {
                    return Err("timeout must be 1..30000 ms");
                }
                s.armed = Some(Duration::from_millis(timeout_ms));
            }
            Control::Approve | Control::Deny | Control::Timeout | Control::ApproveAndDrop => {
                let p = s.pending.take().ok_or("no pending request")?;
                if matches!(action, Control::Approve | Control::ApproveAndDrop) {
                    if s.append_duplicates
                        || !s
                            .authorized_keys
                            .iter()
                            .any(|k| k.split_whitespace().nth(1) == p.key.split_whitespace().nth(1))
                    {
                        s.authorized_keys.push(p.key.clone());
                    }
                    s.registrations.push(p.key);
                }
                let decision = match action {
                    Control::Approve => Decision::Approved,
                    Control::ApproveAndDrop => Decision::Dropped,
                    Control::Deny => Decision::Denied,
                    _ => Decision::TimedOut,
                };
                let _ = p.answer.send(decision);
            }
            Control::AppendDuplicates { enabled } => s.append_duplicates = enabled,
            Control::Scenario { name } => {
                let fixtures = discovery_fixtures();
                if !fixtures.iter().any(|f| f.name == name)
                    && !["older", "incompatible", "wrong-daemon"].contains(&name.as_str())
                {
                    return Err("unknown scenario");
                }
                s.device_id = fixtures
                    .iter()
                    .find(|f| f.name == name)
                    .map(|f| f.companion_device_id.clone())
                    .unwrap_or_else(|| DEVICE_ID.into());
                s.build = if name == "older" {
                    "0.1.0-simulator"
                } else {
                    "0.2.0-simulator"
                }
                .into();
                s.protocol = if name == "incompatible" {
                    Protocol { major: 2, minor: 0 }
                } else if name == "older" {
                    Protocol { major: 1, minor: 0 }
                } else {
                    PROTOCOL
                };
                s.discovery = name;
                self.disconnect.send_modify(|n| *n += 1);
            }
            Control::Steamvr { ready } => {
                s.steamvr = if ready {
                    SteamVrState::Ready
                } else {
                    SteamVrState::Unavailable
                }
            }
            Control::Offline => {
                s.online = false;
                self.disconnect.send_modify(|n| *n += 1);
            }
            Control::Online => s.online = true,
            Control::Disconnect => self.disconnect.send_modify(|n| *n += 1),
            Control::Reset => {
                *s = State::default();
                self.disconnect.send_modify(|n| *n += 1);
            }
        }
        Ok(())
    }

    pub async fn start(&self, http_port: u16, companion_port: u16) -> io::Result<Running> {
        self.start_on(std::net::Ipv4Addr::LOCALHOST, http_port, companion_port)
            .await
    }

    pub async fn start_on(
        &self,
        address: std::net::Ipv4Addr,
        http_port: u16,
        companion_port: u16,
    ) -> io::Result<Running> {
        if !address.is_loopback() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "only loopback addresses are allowed",
            ));
        }
        let http = TcpListener::bind((address, http_port)).await?;
        let wss = TcpListener::bind((address, companion_port)).await?;
        let addresses = (http.local_addr()?, wss.local_addr()?);
        let provider = rustls::crypto::ring::default_provider();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(provider))
            .with_safe_default_protocol_versions()
            .map_err(io::Error::other)?
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from(SERVER_CERT.to_vec())],
                PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(SERVER_KEY.to_vec())),
            )
            .map_err(io::Error::other)?;
        let acceptor = TlsAcceptor::from(Arc::new(config));
        let sim = self.clone();
        let http_task = tokio::spawn(async move {
            let mut clients = JoinSet::new();
            loop {
                tokio::select! {
                    accepted = http.accept() => {
                        let Ok((stream, _)) = accepted else { break };
                        let sim = sim.clone();
                        clients.spawn(async move {
                            let connection = hyper::server::conn::http1::Builder::new()
                                .serve_connection(TokioIo::new(stream), service_fn(move |req| http_request(sim.clone(), req)));
                            let _ = timeout(Duration::from_secs(35), connection).await;
                        });
                    }
                    _ = clients.join_next(), if !clients.is_empty() => {}
                }
            }
        });
        let sim = self.clone();
        let wss_task = tokio::spawn(async move {
            let mut clients = JoinSet::new();
            loop {
                tokio::select! {
                    accepted = wss.accept() => {
                        let Ok((stream, _)) = accepted else { break };
                        if !sim.state.lock().unwrap().online { continue; }
                        let sim = sim.clone();
                        let acceptor = acceptor.clone();
                        clients.spawn(async move {
                            let Ok(Ok(tls)) = timeout(Duration::from_secs(3), acceptor.accept(stream)).await else { return };
                            companion(sim, tls).await;
                        });
                    }
                    _ = clients.join_next(), if !clients.is_empty() => {}
                }
            }
        });
        Ok(Running {
            http: addresses.0,
            companion: addresses.1,
            tasks: vec![http_task, wss_task],
        })
    }
}

pub struct Running {
    pub http: SocketAddr,
    pub companion: SocketAddr,
    tasks: Vec<JoinHandle<()>>,
}
impl Running {
    pub async fn stop(mut self) {
        for task in &self.tasks {
            task.abort();
        }
        for task in self.tasks.drain(..) {
            let _ = task.await;
        }
    }
}
impl Drop for Running {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

fn response(status: StatusCode, text: impl Into<Bytes>) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain")
        .body(Full::new(text.into()))
        .unwrap()
}

fn registration_error(message: &str) -> Response<Full<Bytes>> {
    response(
        StatusCode::FORBIDDEN,
        serde_json::json!({"error": message}).to_string(),
    )
}

struct PendingGuard {
    sim: Simulator,
    id: u64,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        let mut s = self.sim.state.lock().unwrap();
        if s.pending.as_ref().is_some_and(|p| p.id == self.id) {
            s.pending.take();
        }
    }
}

async fn http_request(
    sim: Simulator,
    req: HttpRequest<hyper::body::Incoming>,
) -> io::Result<Response<Full<Bytes>>> {
    let path = req.uri().path().to_owned();
    let method = req.method().clone();
    if path.starts_with("/__sim/")
        && req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            != Some(&format!("Bearer {CONTROL_TOKEN}"))
    {
        return Ok(response(
            StatusCode::UNAUTHORIZED,
            "operator authentication required",
        ));
    }
    if method == hyper::Method::GET {
        let body = match path.as_str() {
            "/properties.json" => {
                r#"{"txtvers":1,"login":"steamos","settings":"{}","devkit1":["synthetic-devkit"]}"#
                    .into()
            }
            "/login-name" => "steamos".into(),
            "/" if req.uri().query() == Some("command=ping") => "pong\n".into(),
            "/__sim/state" => serde_json::to_string(&sim.snapshot()).unwrap(),
            "/__sim/discovery" => {
                let name = sim.state.lock().unwrap().discovery.clone();
                let fixture = discovery_fixtures().into_iter().find(|f| f.name == name);
                serde_json::to_string(&fixture).unwrap()
            }
            _ => return Ok(response(StatusCode::NOT_FOUND, "not found")),
        };
        let mut result = response(StatusCode::OK, body);
        if path == "/properties.json" || path.starts_with("/__sim/") {
            result
                .headers_mut()
                .insert("content-type", "application/json".parse().unwrap());
        }
        return Ok(result);
    }
    if method != hyper::Method::POST || !["/register", "/__sim/control"].contains(&path.as_str()) {
        return Ok(response(StatusCode::NOT_FOUND, "not found"));
    }
    let limit = if path == "/register" {
        MAX_REGISTRATION_BYTES
    } else {
        MAX_MESSAGE_BYTES
    };
    let body = match timeout(
        Duration::from_secs(3),
        Limited::new(req.into_body(), limit).collect(),
    )
    .await
    {
        Ok(Ok(body)) => body.to_bytes(),
        _ => {
            return Ok(response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "invalid or incomplete body",
            ))
        }
    };
    if path == "/__sim/control" {
        return Ok(match serde_json::from_slice::<Control>(&body) {
            Ok(action) => match sim.control(action) {
                Ok(()) => response(StatusCode::OK, "ok"),
                Err(e) => response(StatusCode::CONFLICT, e),
            },
            Err(_) => response(StatusCode::BAD_REQUEST, "invalid control"),
        });
    }
    let Ok(key) = std::str::from_utf8(&body) else {
        return Ok(registration_error("Failed to write the ssh key"));
    };
    if !valid_rsa_key(key) {
        return Ok(registration_error("Failed to write the ssh key"));
    }
    let (send, mut receive) = oneshot::channel();
    let id = sim.next_request.fetch_add(1, Ordering::Relaxed);
    let wait = {
        let mut s = sim.state.lock().unwrap();
        if s.pending.is_some() {
            return Ok(response(StatusCode::CONFLICT, "busy"));
        }
        let Some(wait) = s.armed.take() else {
            return Ok(registration_error("please put the Steam client in pairing mode: Settings -> Developer -> Pair new host"));
        };
        s.pending = Some(Pending {
            id,
            key: key.trim_end().into(),
            answer: send,
        });
        wait
    };
    let _pending = PendingGuard {
        sim: sim.clone(),
        id,
    };
    let decision = match timeout(wait, &mut receive).await {
        Ok(answer) => answer.unwrap_or(Decision::TimedOut),
        Err(_) => {
            let mut s = sim.state.lock().unwrap();
            // approval and deadline resolve under the same lock
            match receive.try_recv() {
                Ok(answer) => answer,
                Err(_) => {
                    if s.pending.as_ref().is_some_and(|p| p.id == id) {
                        s.pending.take();
                    }
                    Decision::TimedOut
                }
            }
        }
    };
    Ok(match decision {
        Decision::Approved => response(StatusCode::OK, "Registered\n"),
        Decision::Denied => registration_error("pairing request denied"),
        Decision::TimedOut => {
            registration_error("timeout - Steam did not respond to the pairing request")
        }
        Decision::Dropped => {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "simulated uncertain registration",
            ))
        }
    })
}

pub fn valid_rsa_key(key: &str) -> bool {
    let fields: Vec<_> = key.trim_end_matches(['\r', '\n']).split(' ').collect();
    if fields.len() != 3
        || fields[0] != "ssh-rsa"
        || fields[2].is_empty()
        || fields[2]
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return false;
    }
    let Ok(bytes) = STANDARD.decode(fields[1]) else {
        return false;
    };
    let mut rest = bytes.as_slice();
    fn field<'a>(rest: &mut &'a [u8]) -> Option<&'a [u8]> {
        let size = u32::from_be_bytes(rest.get(..4)?.try_into().ok()?) as usize;
        *rest = &rest[4..];
        let value = rest.get(..size)?;
        *rest = &rest[size..];
        Some(value)
    }
    field(&mut rest) == Some(b"ssh-rsa".as_slice())
        && field(&mut rest).is_some_and(|v| !v.is_empty() && v.len() <= 8)
        && field(&mut rest).is_some_and(|v| (256..=1025).contains(&v.len()))
        && rest.is_empty()
}

async fn companion(sim: Simulator, tls: tokio_rustls::server::TlsStream<tokio::net::TcpStream>) {
    let mut disconnected = sim.disconnect.subscribe();
    let mut permit = None;
    #[allow(clippy::result_large_err)]
    let check = |req: &UpgradeRequest, response: UpgradeResponse| {
        let status = if req.uri().path() != "/companion" {
            Some(StatusCode::NOT_FOUND)
        } else if req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            != Some(&format!("Bearer {CLIENT_TOKEN}"))
        {
            Some(StatusCode::UNAUTHORIZED)
        } else if !sim.state.lock().unwrap().online {
            Some(StatusCode::SERVICE_UNAVAILABLE)
        } else {
            match sim.controller.clone().try_acquire_owned() {
                Ok(p) => {
                    permit = Some(p);
                    None
                }
                Err(_) => Some(StatusCode::CONFLICT),
            }
        };
        match status {
            Some(status) => Err(Response::builder()
                .status(status)
                .body(Some(status.to_string()))
                .unwrap()),
            None => Ok(response),
        }
    };
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES));
    let Ok(Ok(mut ws)) = timeout(
        Duration::from_secs(3),
        accept_hdr_async_with_config(tls, check, Some(config)),
    )
    .await
    else {
        return;
    };
    let _permit = permit;
    let mut initialized = false;
    let hello_deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    loop {
        let deadline = if initialized {
            tokio::time::Instant::now() + Duration::from_secs(300)
        } else {
            hello_deadline
        };
        let message = tokio::select! {
            _ = disconnected.changed() => break,
            msg = tokio::time::timeout_at(deadline, ws.next()) => msg,
        };
        let Ok(Some(Ok(message))) = message else {
            break;
        };
        let text = match message {
            Message::Text(text) => text,
            Message::Ping(_) | Message::Pong(_) => {
                let flushed = tokio::select! {
                    _ = disconnected.changed() => break,
                    result = timeout(Duration::from_secs(3), ws.flush()) => result,
                };
                if !matches!(flushed, Ok(Ok(()))) {
                    break;
                };
                continue;
            }
            _ => break,
        };
        let Ok(req) = serde_json::from_str::<Request>(&text) else {
            break;
        };
        let result = {
            let s = sim.state.lock().unwrap();
            match req.command {
                Command::Hello { .. } if initialized => ReplyResult::Error {
                    code: ProtocolError::AlreadyInitialized,
                },
                Command::Hello {
                    protocol,
                    expected_device_id,
                    expected_daemon_id,
                } => {
                    let daemon_id = if s.discovery == "wrong-daemon" {
                        "synthetic-daemon-b"
                    } else {
                        DAEMON_ID
                    };
                    if protocol.major != s.protocol.major {
                        ReplyResult::Error {
                            code: ProtocolError::IncompatibleProtocol,
                        }
                    } else if expected_device_id != s.device_id || expected_daemon_id != daemon_id {
                        ReplyResult::Error {
                            code: ProtocolError::WrongIdentity,
                        }
                    } else {
                        initialized = true;
                        ReplyResult::Hello {
                            protocol: Protocol {
                                major: s.protocol.major,
                                minor: protocol.minor.min(s.protocol.minor),
                            },
                            build_version: s.build.clone(),
                            device_id: s.device_id.clone(),
                            daemon_id: daemon_id.into(),
                            capabilities: vec!["status".into()],
                            steamvr: s.steamvr,
                        }
                    }
                }
                Command::GetStatus if initialized => ReplyResult::Status { steamvr: s.steamvr },
                Command::GetStatus => ReplyResult::Error {
                    code: ProtocolError::HelloRequired,
                },
            }
        };
        let failed = matches!(result, ReplyResult::Error { .. });
        let reply = serde_json::to_string(&Reply { id: req.id, result }).unwrap();
        if !matches!(
            timeout(Duration::from_secs(3), ws.send(Message::Text(reply.into()))).await,
            Ok(Ok(()))
        ) {
            break;
        }
        if failed {
            break;
        }
    }
    let _ = timeout(Duration::from_millis(100), ws.close(None)).await;
}

pub fn discovery_fixtures() -> Vec<DiscoveryFixture> {
    serde_json::from_str(include_str!("../fixtures/discovery.json"))
        .expect("checked synthetic fixtures")
}
