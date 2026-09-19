use futures_util::{SinkExt, StreamExt};
use oyasumivr_frame_companion::{
    config::CompanionConfig,
    server::{self, ServerState},
};
use oyasumivr_shared::frame::{
    Command, Protocol, ProtocolError, Reply, ReplyResult, Request, SteamVrState, MAX_MESSAGE_BYTES,
    PROTOCOL,
};
use rcgen::generate_simple_self_signed;
use std::{
    net::{IpAddr, Ipv4Addr},
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tempfile::TempDir;
use tokio::{net::TcpStream, time::timeout};
use tokio_rustls::rustls::{self, pki_types::CertificateDer};
use tokio_tungstenite::{
    client_async_tls_with_config,
    tungstenite::{self, client::IntoClientRequest, Message},
    Connector, MaybeTlsStream, WebSocketStream,
};

type WebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
const SERVER_NAME: &str = "oyasumivr-frame-companion";

struct TestServer {
    _directory: TempDir,
    certificate: Vec<u8>,
    state: ServerState,
    running: server::RunningServer,
}

impl TestServer {
    async fn start() -> Self {
        let directory = TempDir::new().unwrap();
        let certified = generate_simple_self_signed(vec![SERVER_NAME.into()]).unwrap();
        let certificate = certified.cert.pem().into_bytes();
        let certificate_path = directory.path().join("server.pem");
        let key_path = directory.path().join("server-key.pem");
        std::fs::write(&certificate_path, &certificate).unwrap();
        std::fs::write(&key_path, certified.key_pair.serialize_pem()).unwrap();
        let config = CompanionConfig {
            bind_address: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 0,
            device_id: "synthetic-device".into(),
            daemon_id: "synthetic-daemon".into(),
            client_token: "synthetic-client-token-with-more-than-32-bytes".into(),
            certificate_path: certificate_path.display().to_string(),
            private_key_path: key_path.display().to_string(),
            openvr_library_path: None,
        };
        let state = ServerState::new(config, "0.2.0-test".into());
        let running = server::start(state.clone()).await.unwrap();
        Self {
            _directory: directory,
            certificate,
            state,
            running,
        }
    }

    async fn connect(&self, token: &str) -> Result<WebSocket, tungstenite::Error> {
        let mut certificate_slice = self.certificate.as_slice();
        let mut certificates = rustls_pemfile::certs(&mut certificate_slice);
        let certificate: CertificateDer<'static> = certificates.next().unwrap().unwrap();
        let mut roots = rustls::RootCertStore::empty();
        roots.add(certificate).unwrap();
        let provider = rustls::crypto::ring::default_provider();
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(provider))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let stream = TcpStream::connect(self.running.address).await.unwrap();
        let mut request = format!(
            "wss://{SERVER_NAME}:{}/companion",
            self.running.address.port()
        )
        .into_client_request()
        .unwrap();
        request
            .headers_mut()
            .insert("authorization", format!("Bearer {token}").parse().unwrap());
        client_async_tls_with_config(
            request,
            stream,
            None,
            Some(Connector::Rustls(Arc::new(tls))),
        )
        .await
        .map(|(socket, _)| socket)
    }
}

async fn exchange(socket: &mut WebSocket, id: u64, command: Command) -> ReplyResult {
    socket
        .send(Message::Text(
            serde_json::to_string(&Request { id, command })
                .unwrap()
                .into(),
        ))
        .await
        .unwrap();
    let text = timeout(Duration::from_secs(2), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
        .into_text()
        .unwrap();
    let reply: Reply = serde_json::from_str(&text).unwrap();
    assert_eq!(reply.id, id);
    reply.result
}

fn hello(protocol: Protocol, device: &str, daemon: &str) -> Command {
    Command::Hello {
        protocol,
        expected_device_id: device.into(),
        expected_daemon_id: daemon.into(),
    }
}

async fn closed(socket: &mut WebSocket) {
    let result = timeout(Duration::from_secs(2), socket.next())
        .await
        .unwrap();
    assert!(matches!(
        result,
        None | Some(Err(_)) | Some(Ok(Message::Close(_)))
    ));
}

#[tokio::test]
async fn reports_real_runtime_state_without_losing_connectivity() {
    let server = TestServer::start().await;
    let mut socket = server
        .connect(&server.state.config.client_token)
        .await
        .unwrap();
    assert!(matches!(
        exchange(
            &mut socket,
            1,
            hello(PROTOCOL, "synthetic-device", "synthetic-daemon")
        )
        .await,
        ReplyResult::Hello {
            protocol: PROTOCOL,
            build_version,
            steamvr: SteamVrState::Unavailable,
            capabilities,
            ..
        } if build_version == "0.2.0-test" && capabilities == ["status"]
    ));
    server.state.steamvr_ready.store(true, Ordering::Release);
    assert!(matches!(
        exchange(&mut socket, 2, Command::GetStatus).await,
        ReplyResult::Status {
            steamvr: SteamVrState::Ready
        }
    ));
    server.running.stop().await;
    closed(&mut socket).await;
}

#[tokio::test]
async fn rejects_authentication_identity_protocol_and_competing_controller() {
    let server = TestServer::start().await;
    let failure = server.connect("wrong-token").await.unwrap_err();
    assert!(matches!(failure, tungstenite::Error::Http(ref response) if response.status() == 401));
    for command in [
        hello(PROTOCOL, "wrong-device", "synthetic-daemon"),
        hello(
            Protocol {
                major: PROTOCOL.major + 1,
                minor: 0,
            },
            "synthetic-device",
            "synthetic-daemon",
        ),
    ] {
        let mut socket = server
            .connect(&server.state.config.client_token)
            .await
            .unwrap();
        assert!(matches!(
            exchange(&mut socket, 1, command).await,
            ReplyResult::Error {
                code: ProtocolError::WrongIdentity | ProtocolError::IncompatibleProtocol
            }
        ));
        closed(&mut socket).await;
    }
    let mut controller = server
        .connect(&server.state.config.client_token)
        .await
        .unwrap();
    assert!(matches!(
        exchange(
            &mut controller,
            1,
            hello(PROTOCOL, "synthetic-device", "synthetic-daemon")
        )
        .await,
        ReplyResult::Hello { .. }
    ));
    let busy = server
        .connect(&server.state.config.client_token)
        .await
        .unwrap_err();
    assert!(matches!(busy, tungstenite::Error::Http(ref response) if response.status() == 409));
    server.running.stop().await;
}

#[tokio::test]
async fn rejects_uninitialized_duplicate_malformed_and_oversized_messages() {
    let server = TestServer::start().await;
    let mut socket = server
        .connect(&server.state.config.client_token)
        .await
        .unwrap();
    assert!(matches!(
        exchange(&mut socket, 1, Command::GetStatus).await,
        ReplyResult::Error {
            code: ProtocolError::HelloRequired
        }
    ));
    closed(&mut socket).await;

    let mut socket = server
        .connect(&server.state.config.client_token)
        .await
        .unwrap();
    exchange(
        &mut socket,
        1,
        hello(PROTOCOL, "synthetic-device", "synthetic-daemon"),
    )
    .await;
    socket
        .send(Message::Text(
            serde_json::to_string(&Request {
                id: 1,
                command: Command::GetStatus,
            })
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    closed(&mut socket).await;

    for text in ["not-json".to_owned(), "x".repeat(MAX_MESSAGE_BYTES + 1)] {
        let mut socket = server
            .connect(&server.state.config.client_token)
            .await
            .unwrap();
        socket.send(Message::Text(text.into())).await.unwrap();
        closed(&mut socket).await;
    }
    server.running.stop().await;
}
