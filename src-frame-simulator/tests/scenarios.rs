use futures_util::{SinkExt, StreamExt};
use oyasumivr_frame_simulator::{contracts::*, simulator::*};
use std::{sync::Arc, time::Duration};
use tokio::{
    net::TcpStream,
    time::{timeout, Instant},
};
use tokio_rustls::rustls::{self, pki_types::CertificateDer};
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::{self, client::IntoClientRequest, Message},
    Connector, MaybeTlsStream, WebSocketStream,
};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
const KEY: &str = include_str!("../fixtures/client.pub");

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(4))
        .build()
        .unwrap()
}

async fn control(run: &Running, action: Control) {
    let response = http()
        .post(format!("http://{}/__sim/control", run.http))
        .bearer_auth(CONTROL_TOKEN)
        .body(serde_json::to_vec(&action).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        200,
        "control failed: {}",
        response.text().await.unwrap()
    );
}

async fn pending(run: &Running) {
    let until = Instant::now() + Duration::from_secs(2);
    loop {
        let text = http()
            .get(format!("http://{}/__sim/state", run.http))
            .bearer_auth(CONTROL_TOKEN)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        if serde_json::from_str::<Snapshot>(&text).unwrap().pending {
            return;
        }
        assert!(
            Instant::now() < until,
            "registration did not become pending"
        );
        tokio::task::yield_now().await;
    }
}

fn register(run: &Running) -> tokio::task::JoinHandle<Result<reqwest::Response, reqwest::Error>> {
    let url = format!("http://{}/register", run.http);
    tokio::spawn(async move { http().post(url).body(KEY).send().await })
}

async fn connect(run: &Running, token: &str, cert: &[u8]) -> Result<Ws, tungstenite::Error> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(CertificateDer::from(cert.to_vec())).unwrap();
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_root_certificates(roots)
    .with_no_client_auth();
    let mut req = format!("wss://{}/companion", run.companion)
        .into_client_request()
        .unwrap();
    req.headers_mut()
        .insert("authorization", format!("Bearer {token}").parse().unwrap());
    let result = timeout(
        Duration::from_secs(3),
        connect_async_tls_with_config(req, None, false, Some(Connector::Rustls(Arc::new(config)))),
    )
    .await
    .expect("bounded connection");
    result.map(|(ws, _)| ws)
}

async fn exchange(ws: &mut Ws, id: u64, command: Command) -> ReplyResult {
    ws.send(Message::Text(
        serde_json::to_string(&Request { id, command })
            .unwrap()
            .into(),
    ))
    .await
    .unwrap();
    let text = timeout(Duration::from_secs(2), ws.next())
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

fn hello() -> Command {
    Command::Hello {
        protocol: PROTOCOL,
        expected_device_id: DEVICE_ID.into(),
        expected_daemon_id: DAEMON_ID.into(),
    }
}

async fn closed(ws: &mut Ws) {
    let result = timeout(Duration::from_secs(2), ws.next()).await.unwrap();
    assert!(matches!(
        result,
        None | Some(Err(_)) | Some(Ok(Message::Close(_)))
    ));
    let _ = ws.close(None).await;
}

#[tokio::test]
async fn happy_path_registration_and_authenticated_companion() {
    let sim = Simulator::default();
    let run = sim.start(0, 0).await.unwrap();
    for (path, expected) in [("/login-name", "steamos"), ("/?command=ping", "pong\n")] {
        assert_eq!(
            http()
                .get(format!("http://{}{path}", run.http))
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            expected
        );
    }
    let properties: serde_json::Value = serde_json::from_str(
        &http()
            .get(format!("http://{}/properties.json", run.http))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(properties["login"], "steamos");
    control(&run, Control::Arm { timeout_ms: 30000 }).await;
    let request = register(&run);
    pending(&run).await;
    assert!(!request.is_finished());
    control(&run, Control::Approve).await;
    assert_eq!(request.await.unwrap().unwrap().status(), 200);
    assert!(sim.registered(KEY));
    let mut ws = connect(&run, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
    assert!(matches!(
        exchange(&mut ws, 42, hello()).await,
        ReplyResult::Hello {
            protocol: PROTOCOL,
            steamvr: SteamVrState::Ready,
            ..
        }
    ));
    assert!(matches!(
        exchange(&mut ws, 43, Command::GetStatus).await,
        ReplyResult::Status {
            steamvr: SteamVrState::Ready
        }
    ));
    run.stop().await;
}

#[tokio::test]
async fn unarmed_denied_and_controlled_timeout() {
    let sim = Simulator::default();
    let run = sim.start(0, 0).await.unwrap();
    let response = register(&run).await.unwrap().unwrap();
    assert_eq!(response.status(), 403);
    assert!(response.text().await.unwrap().contains("pairing mode"));
    for (decision, status, body) in [
        (Control::Deny, 403, "pairing request denied"),
        (
            Control::Timeout,
            403,
            "timeout - Steam did not respond to the pairing request",
        ),
    ] {
        control(&run, Control::Arm { timeout_ms: 30000 }).await;
        let request = register(&run);
        pending(&run).await;
        control(&run, decision).await;
        let response = request.await.unwrap().unwrap();
        assert_eq!(response.status(), status);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&response.text().await.unwrap()).unwrap()
                ["error"],
            body
        );
        assert_eq!(sim.snapshot().registrations, 0);
    }
    control(&run, Control::Arm { timeout_ms: 10 }).await;
    assert_eq!(register(&run).await.unwrap().unwrap().status(), 403);
    assert!(!sim.snapshot().pending);
    run.stop().await;
}

#[tokio::test]
async fn uncertain_result_reuses_key_and_explicit_retries_append_duplicates() {
    let sim = Simulator::default();
    let run = sim.start(0, 0).await.unwrap();
    control(&run, Control::Arm { timeout_ms: 30000 }).await;
    let request = register(&run);
    pending(&run).await;
    control(&run, Control::ApproveAndDrop).await;
    assert!(
        request.await.unwrap().is_err(),
        "must lose the actual HTTP response"
    );
    assert!(
        sim.registered(KEY),
        "installation survived the lost response"
    );
    assert_eq!(sim.snapshot().registrations, 1);
    control(&run, Control::Arm { timeout_ms: 30000 }).await;
    let retry = register(&run);
    pending(&run).await;
    control(&run, Control::Approve).await;
    assert_eq!(retry.await.unwrap().unwrap().status(), 200);
    assert_eq!(sim.snapshot().registrations, 2);
    assert_eq!(sim.snapshot().authorized_keys, 1);
    control(&run, Control::AppendDuplicates { enabled: true }).await;
    control(&run, Control::Arm { timeout_ms: 30000 }).await;
    let duplicate = register(&run);
    pending(&run).await;
    control(&run, Control::Approve).await;
    duplicate.await.unwrap().unwrap();
    assert_eq!(sim.snapshot().registrations, 3);
    assert_eq!(sim.snapshot().authorized_keys, 2);
    run.stop().await;
}

#[tokio::test]
async fn rejects_malformed_keys_busy_registration_and_unauthorized_controls() {
    let sim = Simulator::default();
    let run = sim.start(0, 0).await.unwrap();
    let key_without_comment = KEY.split_whitespace().take(2).collect::<Vec<_>>().join(" ");
    for key in [
        "ssh-ed25519 AAAA disposable".to_owned(),
        "ssh-rsa AAAA disposable".into(),
        format!("{} extra", KEY.trim()),
        key_without_comment,
        KEY.replace(' ', "  "),
    ] {
        assert_eq!(
            http()
                .post(format!("http://{}/register", run.http))
                .body(key)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    assert_eq!(
        http()
            .post(format!("http://{}/register", run.http))
            .body("a".repeat(MAX_REGISTRATION_BYTES + 1))
            .send()
            .await
            .unwrap()
            .status(),
        413
    );
    assert_eq!(
        http()
            .post(format!("http://{}/__sim/control", run.http))
            .body(r#"{"action":"arm","timeout_ms":1000}"#)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    control(&run, Control::Arm { timeout_ms: 30000 }).await;
    let first = register(&run);
    pending(&run).await;
    assert_eq!(register(&run).await.unwrap().unwrap().status(), 409);
    control(&run, Control::Deny).await;
    first.await.unwrap().unwrap();
    run.stop().await;
}

#[tokio::test]
async fn authentication_and_server_trust_fail_at_network_boundary() {
    let sim = Simulator::default();
    let run = sim.start(0, 0).await.unwrap();
    let failure = connect(&run, "invalid-credential", SERVER_CERT)
        .await
        .unwrap_err();
    assert!(matches!(failure, tungstenite::Error::Http(ref r) if r.status() == 401));
    let failure = connect(
        &run,
        CLIENT_TOKEN,
        include_bytes!("../fixtures/other-server.der"),
    )
    .await
    .unwrap_err();
    assert!(
        matches!(
            failure,
            tungstenite::Error::Io(_) | tungstenite::Error::Tls(_)
        ),
        "{failure:?}"
    );
    let mut ws = connect(&run, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
    assert!(matches!(
        exchange(&mut ws, 1, hello()).await,
        ReplyResult::Hello { .. }
    ));
    let busy = connect(&run, CLIENT_TOKEN, SERVER_CERT).await.unwrap_err();
    assert!(matches!(busy, tungstenite::Error::Http(ref r) if r.status() == 409));
    run.stop().await;
}

#[tokio::test]
async fn identity_and_protocol_failures_close_connection() {
    for scenario in ["wrong-device", "non-frame", "wrong-daemon", "incompatible"] {
        let sim = Simulator::default();
        let run = sim.start(0, 0).await.unwrap();
        control(
            &run,
            Control::Scenario {
                name: scenario.into(),
            },
        )
        .await;
        let mut ws = connect(&run, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
        let expected = if scenario == "incompatible" {
            ProtocolError::IncompatibleProtocol
        } else {
            ProtocolError::WrongIdentity
        };
        assert!(
            matches!(exchange(&mut ws, 9, hello()).await, ReplyResult::Error { code } if code == expected)
        );
        closed(&mut ws).await;
        run.stop().await;
    }
}

#[tokio::test]
async fn older_build_is_compatible_and_steamvr_unavailable_is_not_offline() {
    let sim = Simulator::default();
    let run = sim.start(0, 0).await.unwrap();
    control(
        &run,
        Control::Scenario {
            name: "older".into(),
        },
    )
    .await;
    control(&run, Control::Steamvr { ready: false }).await;
    let mut ws = connect(&run, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
    match exchange(&mut ws, 1, hello()).await {
        ReplyResult::Hello {
            protocol,
            build_version,
            steamvr,
            capabilities,
            ..
        } => {
            assert_eq!(protocol, Protocol { major: 1, minor: 0 });
            assert_eq!(build_version, "0.1.0-simulator");
            assert_eq!(steamvr, SteamVrState::Unavailable);
            assert_eq!(capabilities, vec!["status"]);
        }
        other => panic!("{other:?}"),
    }
    control(&run, Control::Steamvr { ready: true }).await;
    assert!(matches!(
        exchange(&mut ws, 2, Command::GetStatus).await,
        ReplyResult::Status {
            steamvr: SteamVrState::Ready
        }
    ));
    run.stop().await;
}

#[tokio::test]
async fn offline_disconnect_and_reconnect_preserve_pairing_identity() {
    let sim = Simulator::default();
    let run = sim.start(0, 0).await.unwrap();
    control(&run, Control::Arm { timeout_ms: 30000 }).await;
    let registration = register(&run);
    pending(&run).await;
    control(&run, Control::Approve).await;
    registration.await.unwrap().unwrap();
    for action in [Control::Offline, Control::Disconnect] {
        let mut ws = connect(&run, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
        assert!(matches!(
            exchange(&mut ws, 1, hello()).await,
            ReplyResult::Hello { .. }
        ));
        let offline = matches!(action, Control::Offline);
        control(&run, action).await;
        closed(&mut ws).await;
        if offline {
            assert!(connect(&run, CLIENT_TOKEN, SERVER_CERT).await.is_err());
        }
        control(&run, Control::Online).await;
        assert_eq!(sim.snapshot().registrations, 1);
    }
    let mut ws = connect(&run, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
    assert!(
        matches!(exchange(&mut ws, 2, hello()).await, ReplyResult::Hello { device_id, .. } if device_id == DEVICE_ID)
    );
    run.stop().await;
}

#[tokio::test]
async fn handshake_is_required_and_messages_are_bounded() {
    for malformed in [false, true] {
        let sim = Simulator::default();
        let run = sim.start(0, 0).await.unwrap();
        let mut ws = connect(&run, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
        if malformed {
            ws.send(Message::Text("x".repeat(MAX_MESSAGE_BYTES + 1).into()))
                .await
                .unwrap();
        } else {
            assert!(matches!(
                exchange(&mut ws, 1, Command::GetStatus).await,
                ReplyResult::Error {
                    code: ProtocolError::HelloRequired
                }
            ));
        }
        closed(&mut ws).await;
        run.stop().await;
    }
}

#[test]
fn synthetic_discovery_keeps_hints_separate_from_verified_identity() {
    let fixtures = discovery_fixtures();
    assert_eq!(fixtures.len(), 6);
    let find = |name: &str| fixtures.iter().find(|f| f.name == name).unwrap();
    assert_eq!(find("two").candidates.len(), 2);
    assert_eq!(
        find("one").companion_device_id,
        find("changed-address").companion_device_id
    );
    assert_ne!(
        find("one").candidates[0].address,
        find("changed-address").candidates[0].address
    );
    assert_ne!(
        find("wrong-device").selected_device_id,
        find("wrong-device").companion_device_id
    );
    assert!(!find("discovery-unavailable").discovery_available);
    assert!(matches!(
        find("discovery-unavailable").candidates[0].source,
        DiscoverySource::ExplicitAddress
    ));
    for fixture in &fixtures {
        for candidate in &fixture.candidates {
            assert!(candidate
                .address
                .parse::<std::net::IpAddr>()
                .unwrap()
                .is_loopback());
        }
    }
}

#[tokio::test]
async fn changed_address_and_two_candidates_use_real_independent_endpoints() {
    let sim = Simulator::default();
    let first = sim.start(0, 0).await.unwrap();
    let mut ws = connect(&first, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
    assert!(
        matches!(exchange(&mut ws, 1, hello()).await, ReplyResult::Hello { device_id, .. } if device_id == DEVICE_ID)
    );
    first.stop().await;
    let changed = sim
        .start_on("127.0.0.2".parse().unwrap(), 0, 0)
        .await
        .unwrap();
    let mut ws = connect(&changed, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
    assert!(
        matches!(exchange(&mut ws, 2, hello()).await, ReplyResult::Hello { device_id, .. } if device_id == DEVICE_ID)
    );
    let other = Simulator::default();
    other
        .control(Control::Scenario {
            name: "wrong-device".into(),
        })
        .unwrap();
    let second = other.start(0, 0).await.unwrap();
    let mut wrong = connect(&second, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
    assert!(matches!(
        exchange(&mut wrong, 3, hello()).await,
        ReplyResult::Error {
            code: ProtocolError::WrongIdentity
        }
    ));
    changed.stop().await;
    second.stop().await;
    assert!(sim
        .start_on("0.0.0.0".parse().unwrap(), 0, 0)
        .await
        .is_err());
}

#[tokio::test]
async fn explicit_address_fallback_still_requires_authenticated_identity() {
    let sim = Simulator::default();
    let run = sim.start(0, 0).await.unwrap();
    control(
        &run,
        Control::Scenario {
            name: "discovery-unavailable".into(),
        },
    )
    .await;
    let discovery = http()
        .get(format!("http://{}/__sim/discovery", run.http))
        .bearer_auth(CONTROL_TOKEN)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    let fixture: DiscoveryFixture = serde_json::from_str(&discovery).unwrap();
    assert!(!fixture.discovery_available);
    assert!(matches!(
        fixture.candidates[0].source,
        DiscoverySource::ExplicitAddress
    ));
    let mut ws = connect(&run, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
    assert!(matches!(
        exchange(&mut ws, 1, hello()).await,
        ReplyResult::Hello { .. }
    ));
    run.stop().await;
}

#[tokio::test]
async fn reset_resolves_pending_request_without_clearing_a_new_request() {
    let sim = Simulator::default();
    let run = sim.start(0, 0).await.unwrap();
    control(&run, Control::Arm { timeout_ms: 30000 }).await;
    let old = register(&run);
    pending(&run).await;
    control(&run, Control::Reset).await;
    control(&run, Control::Arm { timeout_ms: 30000 }).await;
    let new = register(&run);
    pending(&run).await;
    assert_eq!(old.await.unwrap().unwrap().status(), 403);
    assert!(sim.snapshot().pending);
    control(&run, Control::Approve).await;
    assert_eq!(new.await.unwrap().unwrap().status(), 200);
    assert_eq!(sim.snapshot().authorized_keys, 1);
    run.stop().await;
}

#[test]
fn pairing_record_roundtrip_does_not_persist_live_connection_state() {
    let record = PairingRecord {
        device_manager_id: "synthetic-desktop-hmd".into(),
        verified_device_id: DEVICE_ID.into(),
        credential_ref: "disposable-reference-only".into(),
        ssh_host_key_sha256: "synthetic-pin".into(),
        daemon_id: DAEMON_ID.into(),
        server_certificate_sha256: "synthetic-certificate-pin".into(),
        last_successful_contact: None,
        last_address: Some("127.0.0.1".into()),
    };
    let json = serde_json::to_string(&record).unwrap();
    assert!(!json.contains("connected"));
    assert_eq!(
        serde_json::from_str::<PairingRecord>(&json).unwrap(),
        record
    );
    let offline = serde_json::to_string(&ConnectionState::Offline).unwrap();
    assert_eq!(offline, r#"{"state":"offline"}"#);
}

#[tokio::test]
async fn reset_releases_controller_when_ping_responses_are_not_read() {
    let sim = Simulator::default();
    let run = sim.start(0, 0).await.unwrap();
    let mut ws = connect(&run, CLIENT_TOKEN, SERVER_CERT).await.unwrap();
    exchange(&mut ws, 1, hello()).await;
    let _ = timeout(Duration::from_secs(2), async {
        loop {
            ws.send(Message::Ping(vec![0; 125].into())).await.unwrap();
        }
    })
    .await;
    control(&run, Control::Reset).await;
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        if let Ok(mut replacement) = connect(&run, CLIENT_TOKEN, SERVER_CERT).await {
            assert!(matches!(
                exchange(&mut replacement, 1, hello()).await,
                ReplyResult::Hello { .. }
            ));
            break;
        }
        assert!(
            Instant::now() < deadline,
            "reset retained the old controller"
        );
        tokio::task::yield_now().await;
    }
    run.stop().await;
}

#[tokio::test]
async fn reused_http_connection_keeps_the_full_approval_window() {
    let sim = Simulator::default();
    let run = sim.start(0, 0).await.unwrap();
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(40))
        .build()
        .unwrap();
    for _ in 0..10 {
        client
            .get(format!("http://{}/properties.json", run.http))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    control(&run, Control::Arm { timeout_ms: 30000 }).await;
    let url = format!("http://{}/register", run.http);
    let registration = tokio::spawn(async move { client.post(url).body(KEY).send().await });
    pending(&run).await;
    tokio::time::sleep(Duration::from_secs(26)).await;
    control(&run, Control::Deny).await;
    assert_eq!(registration.await.unwrap().unwrap().status(), 403);
    run.stop().await;
}
