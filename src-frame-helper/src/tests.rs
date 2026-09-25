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
    tokio::spawn(serve(root.path().to_owned(), listener, acceptor));
    Helper { root, port, cert }
}

async fn connect(helper: &Helper, headers: &[(&str, &str)]) -> Result<String, Error> {
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
    let (mut socket, _) = tokio_tungstenite::client_async(request, tls).await?;
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
