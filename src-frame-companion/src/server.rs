use crate::config::CompanionConfig;
use futures_util::{SinkExt, StreamExt};
use oyasumivr_shared::frame::{
    Command, Protocol, ProtocolError, Reply, ReplyResult, Request, SteamVrState, MAX_MESSAGE_BYTES,
    PROTOCOL,
};
use std::{
    collections::HashSet,
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use subtle::ConstantTimeEq;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{watch, Semaphore},
    task::{JoinHandle, JoinSet},
    time::timeout,
};
use tokio_rustls::{
    rustls::{self, pki_types::CertificateDer},
    TlsAcceptor,
};
use tokio_tungstenite::{
    accept_hdr_async_with_config,
    tungstenite::{
        handshake::server::{Request as UpgradeRequest, Response as UpgradeResponse},
        http::{Response, StatusCode},
        protocol::WebSocketConfig,
        Message,
    },
};

#[derive(Clone)]
pub struct ServerState {
    pub config: CompanionConfig,
    pub build_version: String,
    pub protocol: Protocol,
    pub steamvr_ready: Arc<AtomicBool>,
    controller: Arc<Semaphore>,
}

impl ServerState {
    pub fn new(config: CompanionConfig, build_version: String) -> Self {
        Self {
            config,
            build_version,
            protocol: PROTOCOL,
            steamvr_ready: Arc::new(AtomicBool::new(false)),
            controller: Arc::new(Semaphore::new(1)),
        }
    }

    fn steamvr(&self) -> SteamVrState {
        if self.steamvr_ready.load(Ordering::Acquire) {
            SteamVrState::Ready
        } else {
            SteamVrState::Unavailable
        }
    }
}

pub struct RunningServer {
    pub address: std::net::SocketAddr,
    shutdown: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl RunningServer {
    pub async fn stop(self) {
        let _ = self.shutdown.send(true);
        let _ = timeout(Duration::from_secs(3), self.task).await;
    }
}

pub async fn start(state: ServerState) -> io::Result<RunningServer> {
    let listener = TcpListener::bind((state.config.bind_address, state.config.port)).await?;
    let address = listener.local_addr()?;
    let tls = tls_acceptor(&state.config)?;
    let (shutdown, mut stopping) = watch::channel(false);
    let task = tokio::spawn(async move {
        let mut clients = JoinSet::new();
        loop {
            tokio::select! {
                accepted = listener.accept() => {
                    let (stream, _) = match accepted {
                        Ok(connection) => connection,
                        Err(_) => {
                            tokio::time::sleep(Duration::from_millis(100)).await;
                            continue;
                        }
                    };
                    let state = state.clone();
                    let tls = tls.clone();
                    let stop = stopping.clone();
                    clients.spawn(async move { serve_connection(state, tls, stream, stop).await });
                }
                changed = stopping.changed() => {
                    if changed.is_err() || *stopping.borrow() { break; }
                }
                _ = clients.join_next(), if !clients.is_empty() => {}
            }
        }
        while timeout(Duration::from_secs(1), clients.join_next())
            .await
            .is_ok()
            && !clients.is_empty()
        {}
        clients.abort_all();
    });
    Ok(RunningServer {
        address,
        shutdown,
        task,
    })
}

fn tls_acceptor(config: &CompanionConfig) -> io::Result<TlsAcceptor> {
    let cert_file = std::fs::File::open(&config.certificate_path)?;
    let certs = rustls_pemfile::certs(&mut io::BufReader::new(cert_file))
        .collect::<Result<Vec<CertificateDer<'static>>, _>>()?;
    let key_file = std::fs::File::open(&config.private_key_path)?;
    let key = rustls_pemfile::private_key(&mut io::BufReader::new(key_file))?
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing TLS private key"))?;
    let provider = rustls::crypto::ring::default_provider();
    let tls = rustls::ServerConfig::builder_with_provider(Arc::new(provider))
        .with_safe_default_protocol_versions()
        .map_err(io::Error::other)?
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(io::Error::other)?;
    Ok(TlsAcceptor::from(Arc::new(tls)))
}

async fn serve_connection(
    state: ServerState,
    tls: TlsAcceptor,
    stream: TcpStream,
    mut stopping: watch::Receiver<bool>,
) {
    let Ok(Ok(stream)) = timeout(Duration::from_secs(3), tls.accept(stream)).await else {
        return;
    };
    let mut permit = None;
    let auth = format!("Bearer {}", state.config.client_token);
    #[allow(clippy::result_large_err)]
    let check = |request: &UpgradeRequest, response: UpgradeResponse| {
        let supplied = request
            .headers()
            .get("authorization")
            .map(|value| value.as_bytes())
            .unwrap_or_default();
        let status = if request.uri().path() != "/companion" {
            Some(StatusCode::NOT_FOUND)
        } else if supplied.len() != auth.len() || !bool::from(supplied.ct_eq(auth.as_bytes())) {
            Some(StatusCode::UNAUTHORIZED)
        } else {
            match state.controller.clone().try_acquire_owned() {
                Ok(value) => {
                    permit = Some(value);
                    None
                }
                Err(_) => Some(StatusCode::CONFLICT),
            }
        };
        match status {
            Some(status) => Err(Response::builder()
                .status(status)
                .body(Some(status.to_string()))
                .expect("static response")),
            None => Ok(response),
        }
    };
    let limits = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES));
    let Ok(Ok(mut websocket)) = timeout(
        Duration::from_secs(3),
        accept_hdr_async_with_config(stream, check, Some(limits)),
    )
    .await
    else {
        return;
    };
    let _permit = permit;
    let mut initialized = false;
    let mut ids = HashSet::new();
    let hello_deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    loop {
        let deadline = if initialized {
            tokio::time::Instant::now() + Duration::from_secs(300)
        } else {
            hello_deadline
        };
        let message = tokio::select! {
            changed = stopping.changed() => {
                if changed.is_err() || *stopping.borrow() { break; }
                continue;
            }
            message = tokio::time::timeout_at(deadline, websocket.next()) => message,
        };
        let Ok(Some(Ok(message))) = message else {
            break;
        };
        let text = match message {
            Message::Text(text) => text,
            Message::Ping(_) | Message::Pong(_) => {
                if websocket.flush().await.is_err() {
                    break;
                }
                continue;
            }
            _ => break,
        };
        let Ok(request) = serde_json::from_str::<Request>(&text) else {
            break;
        };
        if !ids.insert(request.id) {
            break;
        }
        let result = match request.command {
            Command::Hello { .. } if initialized => ReplyResult::Error {
                code: ProtocolError::AlreadyInitialized,
            },
            Command::Hello {
                protocol,
                expected_device_id,
                expected_daemon_id,
            } => {
                if protocol.major != state.protocol.major {
                    ReplyResult::Error {
                        code: ProtocolError::IncompatibleProtocol,
                    }
                } else if expected_device_id != state.config.device_id
                    || expected_daemon_id != state.config.daemon_id
                {
                    ReplyResult::Error {
                        code: ProtocolError::WrongIdentity,
                    }
                } else {
                    initialized = true;
                    ReplyResult::Hello {
                        protocol: Protocol {
                            major: state.protocol.major,
                            minor: protocol.minor.min(state.protocol.minor),
                        },
                        build_version: state.build_version.clone(),
                        device_id: state.config.device_id.clone(),
                        daemon_id: state.config.daemon_id.clone(),
                        capabilities: vec!["status".into()],
                        steamvr: state.steamvr(),
                    }
                }
            }
            Command::GetStatus if initialized => ReplyResult::Status {
                steamvr: state.steamvr(),
            },
            Command::GetStatus => ReplyResult::Error {
                code: ProtocolError::HelloRequired,
            },
        };
        let failed = matches!(result, ReplyResult::Error { .. });
        let reply = serde_json::to_string(&Reply {
            id: request.id,
            result,
        })
        .expect("wire reply serializes");
        if !matches!(
            timeout(
                Duration::from_secs(3),
                websocket.send(Message::Text(reply.into()))
            )
            .await,
            Ok(Ok(()))
        ) {
            break;
        }
        if failed {
            break;
        }
    }
    let _ = timeout(Duration::from_millis(200), websocket.close(None)).await;
}
