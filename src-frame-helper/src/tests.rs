use super::*;
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider},
    pki_types::{ServerName, UnixTime},
    ClientConfig, DigitallySignedStruct, SignatureScheme,
};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderName, Error};

#[derive(Debug)]
struct Pinned(CertificateDer<'static>, Arc<CryptoProvider>);

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if end_entity.as_ref() == self.0.as_ref() {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General("unexpected certificate".into()))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.1.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.1.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.1.signature_verification_algorithms.supported_schemes()
    }
}

/// A headset at full brightness and no tint that accepts every write.
struct Headset(f32, [f32; 3]);

impl brightness::Backend for Headset {
    fn connect(&mut self) -> bool {
        true
    }

    fn disconnect(&mut self) {}

    fn capability(&mut self) -> Result<brightness::Capability, brightness::RuntimeLost> {
        Ok(brightness::Capability {
            supported: true,
            min_gain: 0.005,
            max_gain: 1.25,
        })
    }

    fn gain(&mut self) -> Result<f32, brightness::RuntimeLost> {
        Ok(self.0)
    }

    fn set_gain(&mut self, gain: f32) -> Result<(), brightness::RuntimeLost> {
        self.0 = gain;
        Ok(())
    }

    fn standby(&mut self) -> Result<bool, brightness::RuntimeLost> {
        Ok(false)
    }
}

impl cct::ColorGains for Headset {
    fn color_gains(&mut self) -> Result<[Option<f32>; 3], brightness::RuntimeLost> {
        Ok(self.1.map(Some))
    }

    fn set_color_gains(&mut self, gains: [f32; 3]) -> Result<(), brightness::RuntimeLost> {
        self.1 = gains;
        Ok(())
    }
}

type Socket = tokio_tungstenite::WebSocketStream<tokio_rustls::client::TlsStream<TcpStream>>;

struct Helper {
    root: tempfile::TempDir,
    port: u16,
    cert: CertificateDer<'static>,
}

async fn start() -> Helper {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("config.json"), r#"{"port":0}"#).unwrap();
    std::fs::create_dir(root.path().join("clients")).unwrap();
    std::fs::write(root.path().join("clients/pc-a"), "token-a\n").unwrap();
    std::fs::write(root.path().join("clients/pc-b"), "token-b").unwrap();
    let (listener, acceptor) = bind(root.path()).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (cert, _) = ensure_certificate(root.path()).unwrap();
    let hub = hub::start(Headset(1.0, [1.0; 3]));
    // wait for the first poll, so every connection starts from the headset's values
    while hub.subscribe().0.cct.kelvin.is_none() {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    tokio::spawn(serve(root.path().to_owned(), listener, acceptor, hub));
    Helper { root, port, cert }
}

async fn open(helper: &Helper, headers: &[(&str, &str)]) -> Result<Socket, Error> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .unwrap()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Pinned(helper.cert.clone(), provider)))
        .with_no_client_auth();
    let tcp = TcpStream::connect(("127.0.0.1", helper.port))
        .await
        .unwrap();
    let tls = tokio_rustls::TlsConnector::from(Arc::new(config))
        .connect(ServerName::try_from("helper").unwrap(), tcp)
        .await
        .unwrap();
    let mut request = "wss://helper/".into_client_request().unwrap();
    for (name, value) in headers {
        request.headers_mut().insert(
            HeaderName::from_bytes(name.as_bytes()).unwrap(),
            value.parse().unwrap(),
        );
    }
    Ok(tokio_tungstenite::client_async(request, tls).await?.0)
}

async fn next_json(socket: &mut Socket) -> serde_json::Value {
    let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .expect("no message within 5 s")
        .unwrap()
        .unwrap();
    serde_json::from_str(message.to_text().unwrap()).unwrap()
}

async fn connect(helper: &Helper, headers: &[(&str, &str)]) -> Result<String, Error> {
    let mut socket = open(helper, headers).await?;
    Ok(socket.next().await.unwrap()?.into_text()?.to_string())
}

fn is_unauthorized(result: Result<String, Error>) -> bool {
    matches!(result, Err(Error::Http(response)) if response.status() == StatusCode::UNAUTHORIZED)
}

#[tokio::test]
async fn valid_token_receives_hello() {
    let helper = start().await;
    let hello = connect(
        &helper,
        &[(PC_ID_HEADER, "pc-a"), ("authorization", "Bearer token-a")],
    )
    .await
    .unwrap();
    let hello: serde_json::Value = serde_json::from_str(&hello).unwrap();
    assert_eq!(hello["type"], "hello");
    assert_eq!(hello["version"], VERSION);
    assert_eq!(hello["protocolMin"], PROTOCOL_MIN);
    assert_eq!(hello["protocolMax"], PROTOCOL_MAX);
    assert_eq!(hello["digest"].as_str().unwrap().len(), 64);
}

#[tokio::test]
async fn relays_brightness_to_every_pc() {
    let helper = start().await;
    let mut a = open(
        &helper,
        &[(PC_ID_HEADER, "pc-a"), ("authorization", "Bearer token-a")],
    )
    .await
    .unwrap();
    let mut b = open(
        &helper,
        &[(PC_ID_HEADER, "pc-b"), ("authorization", "Bearer token-b")],
    )
    .await
    .unwrap();
    // each PC gets hello, then the current snapshots
    for socket in [&mut a, &mut b] {
        assert_eq!(next_json(socket).await["type"], "hello");
        assert_eq!(
            next_json(socket).await,
            serde_json::json!({"type": "brightness", "runtime": true, "supported": true, "min": 9.0, "max": 125.0, "percentage": 100.0})
        );
        assert_eq!(
            next_json(socket).await,
            serde_json::json!({"type": "cct", "available": true, "gains": [1.0, 1.0, 1.0], "kelvin": 6600, "exact": true})
        );
    }
    // the writer gets a reply, the other PC a snapshot
    let command = r#"{"type":"setBrightness","id":7,"percentage":150}"#;
    a.send(Message::text(command)).await.unwrap();
    assert_eq!(
        next_json(&mut a).await,
        serde_json::json!({"type": "setBrightnessResult", "id": 7, "percentage": 125.0})
    );
    assert_eq!(next_json(&mut b).await["percentage"], 125.0);
    // unknown messages change nothing
    a.send(Message::text(r#"{"type":"other"}"#)).await.unwrap();
    a.send(Message::text(
        r#"{"type":"setBrightness","id":8,"percentage":50}"#,
    ))
    .await
    .unwrap();
    assert_eq!(next_json(&mut a).await["id"], 8);
}

#[tokio::test]
async fn relays_color_temperature_to_every_pc() {
    let helper = start().await;
    let mut a = open(
        &helper,
        &[(PC_ID_HEADER, "pc-a"), ("authorization", "Bearer token-a")],
    )
    .await
    .unwrap();
    let mut b = open(
        &helper,
        &[(PC_ID_HEADER, "pc-b"), ("authorization", "Bearer token-b")],
    )
    .await
    .unwrap();
    for socket in [&mut a, &mut b] {
        for _ in 0..3 {
            next_json(socket).await;
        }
    }
    // the writer gets a reply with the applied snapshot, the other PC a snapshot
    // f32 gains go through JSON text, as the helper writes them
    let gains: serde_json::Value = serde_json::from_str(
        &serde_json::to_string(&color_temperature::kelvin_to_f32_gains(3000)).unwrap(),
    )
    .unwrap();
    let applied =
        serde_json::json!({"available": true, "gains": gains, "kelvin": 3000, "exact": true});
    b.send(Message::text(r#"{"type":"setCct","id":4,"kelvin":3000}"#))
        .await
        .unwrap();
    assert_eq!(
        next_json(&mut b).await,
        serde_json::json!({"type": "setCctResult", "id": 4, "snapshot": applied})
    );
    let mut snapshot = applied.clone();
    snapshot["type"] = "cct".into();
    assert_eq!(next_json(&mut a).await, snapshot);
    // an equal set replies without a snapshot for the other PC
    b.send(Message::text(r#"{"type":"setCct","id":5,"kelvin":3000}"#))
        .await
        .unwrap();
    assert_eq!(next_json(&mut b).await["id"], 5);
    a.send(Message::text(
        r#"{"type":"setBrightness","id":1,"percentage":50}"#,
    ))
    .await
    .unwrap();
    assert_eq!(next_json(&mut a).await["type"], "setBrightnessResult");
}

#[tokio::test]
async fn finishes_a_fade_after_its_pc_disconnects() {
    let helper = start().await;
    let mut a = open(
        &helper,
        &[(PC_ID_HEADER, "pc-a"), ("authorization", "Bearer token-a")],
    )
    .await
    .unwrap();
    let mut b = open(
        &helper,
        &[(PC_ID_HEADER, "pc-b"), ("authorization", "Bearer token-b")],
    )
    .await
    .unwrap();
    for socket in [&mut a, &mut b] {
        next_json(socket).await;
        next_json(socket).await;
        next_json(socket).await;
    }

    // the sender gets a reply and progress, then leaves
    let command = r#"{"type":"fade","id":3,"control":"brightness","operation":"op-1","target":50,"durationMs":600}"#;
    a.send(Message::text(command)).await.unwrap();
    let report = next_json(&mut a).await;
    assert_eq!(report["type"], "brightness");
    assert_eq!(report["fade"]["operation"], "op-1");
    assert_eq!(report["fade"]["target"], 50.0);
    assert_eq!(
        next_json(&mut a).await,
        serde_json::json!({"type": "fadeResult", "id": 3})
    );
    drop(a);

    // the other PC follows the fade to its end
    let mut outcome = None;
    while outcome.is_none() {
        let message = next_json(&mut b).await;
        if message["type"] == "fadeEnded" {
            outcome = Some(message);
        }
    }
    assert_eq!(
        outcome.unwrap(),
        serde_json::json!({"type": "fadeEnded", "control": "brightness", "operation": "op-1", "outcome": "completed"})
    );
}

#[tokio::test]
async fn rejects_invalid_tokens() {
    let helper = start().await;
    let cases: &[&[(&str, &str)]] = &[
        &[(PC_ID_HEADER, "pc-a"), ("authorization", "Bearer token-b")],
        &[(PC_ID_HEADER, "pc-a"), ("authorization", "Bearer ")],
        &[(PC_ID_HEADER, "pc-a")],
        &[("authorization", "Bearer token-a")],
        &[(PC_ID_HEADER, "pc-c"), ("authorization", "Bearer token-a")],
        &[
            (PC_ID_HEADER, "../clients/pc-a"),
            ("authorization", "Bearer token-a"),
        ],
    ];
    for headers in cases {
        assert!(
            is_unauthorized(connect(&helper, headers).await),
            "{headers:?}"
        );
    }
}

#[tokio::test]
async fn removed_token_file_revokes_access() {
    let helper = start().await;
    let headers = [(PC_ID_HEADER, "pc-b"), ("authorization", "Bearer token-b")];
    assert!(connect(&helper, &headers).await.is_ok());
    std::fs::remove_file(helper.root.path().join("clients/pc-b")).unwrap();
    assert!(is_unauthorized(connect(&helper, &headers).await));
}

#[test]
fn certificate_is_created_once() {
    let root = tempfile::tempdir().unwrap();
    let (first, _) = ensure_certificate(root.path()).unwrap();
    let (second, _) = ensure_certificate(root.path()).unwrap();
    assert_eq!(first, second);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |path: &str| {
            std::fs::metadata(root.path().join(path))
                .unwrap()
                .permissions()
                .mode()
                & 0o777
        };
        assert_eq!(mode("tls"), 0o700);
        assert_eq!(mode("tls/key.pem"), 0o600);
    }
}

#[test]
fn unusable_certificate_is_replaced() {
    let root = tempfile::tempdir().unwrap();
    let (first, _) = ensure_certificate(root.path()).unwrap();
    let other = rcgen::generate_simple_self_signed(vec!["other".into()]).unwrap();
    std::fs::write(
        root.path().join("tls/key.pem"),
        other.signing_key.serialize_pem(),
    )
    .unwrap();
    let (second, key) = ensure_certificate(root.path()).unwrap();
    assert_ne!(first, second);
    assert!(tls_config(second.clone(), key).is_ok());
    std::fs::write(root.path().join("tls/cert.pem"), "").unwrap();
    let (third, _) = ensure_certificate(root.path()).unwrap();
    assert_ne!(second, third);
}

#[test]
fn identity_needs_all_three_values() {
    let full = r#"{"LastKnown":{"HMDSerialNumber":"S1","HMDModel":"M","HMDManufacturer":"V"}}"#;
    assert_eq!(
        parse_identity(full),
        Some(Identity {
            serial: "S1".into(),
            model: "M".into(),
            manufacturer: "V".into(),
        })
    );
    let partial = r#"{"LastKnown":{"HMDSerialNumber":"S1","HMDModel":"","HMDManufacturer":"V"}}"#;
    assert_eq!(parse_identity(partial), None);
    assert_eq!(parse_identity("{}"), None);
    assert_eq!(parse_identity("not json"), None);
}
