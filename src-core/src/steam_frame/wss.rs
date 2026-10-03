use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use futures_util::StreamExt;
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider},
    pki_types::{CertificateDer, ServerName, UnixTime},
    ClientConfig, DigitallySignedStruct, SignatureScheme,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;
use tokio_tungstenite::{
    tungstenite::{self, client::IntoClientRequest, http::StatusCode, Message},
    WebSocketStream,
};

use super::{hex, models::Identity, setup::HelperInfo};

pub type Socket = WebSocketStream<TlsStream<TcpStream>>;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    #[serde(flatten)]
    pub info: HelperInfo,
    pub identity: Option<Identity>,
}

#[derive(Debug, PartialEq)]
pub enum WssError {
    Unreachable,
    /// The helper presented a certificate other than the pinned one, with this fingerprint.
    CertificateChanged(String),
    Unauthorized,
    Failed(String),
}

/// Trusts exactly one certificate, identified by the SHA-256 of its DER encoding.
#[derive(Debug)]
struct PinnedCertificate {
    pin: String,
    observed: Arc<Mutex<Option<String>>>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for PinnedCertificate {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let fingerprint = hex(&Sha256::digest(end_entity.as_ref()));
        let trusted = fingerprint == self.pin;
        *self.observed.lock().unwrap() = Some(fingerprint);
        if trusted {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General("unpinned certificate".into()))
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
            &self.provider.signature_verification_algorithms,
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
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Opens an authenticated WSS connection and reads the helper's hello.
pub async fn connect(
    address: &str,
    port: u16,
    cert_pin: &str,
    pc_id: &str,
    token: &str,
) -> Result<(Socket, Hello), WssError> {
    // open the TCP connection
    let tcp =
        match tokio::time::timeout(Duration::from_secs(5), TcpStream::connect((address, port)))
            .await
        {
            Ok(Ok(tcp)) => tcp,
            _ => return Err(WssError::Unreachable),
        };

    // TLS that trusts only the pinned certificate
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let observed = Arc::new(Mutex::new(None));
    let verifier = PinnedCertificate {
        pin: cert_pin.to_owned(),
        observed: observed.clone(),
        provider: provider.clone(),
    };
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| WssError::Failed(e.to_string()))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    let server_name = ServerName::try_from("oyasumivr-frame-helper").unwrap();
    let tls = tokio::time::timeout(
        Duration::from_secs(10),
        tokio_rustls::TlsConnector::from(Arc::new(config)).connect(server_name, tcp),
    )
    .await;

    // report a changed certificate when the handshake saw one
    let tls = match tls {
        Ok(Ok(tls)) => tls,
        _ => {
            return Err(match observed.lock().unwrap().clone() {
                Some(fingerprint) if fingerprint != cert_pin => {
                    WssError::CertificateChanged(fingerprint)
                }
                _ => WssError::Unreachable,
            })
        }
    };

    // request the upgrade with this PC's id and token
    let mut request = "wss://oyasumivr-frame-helper/"
        .into_client_request()
        .map_err(|e| WssError::Failed(e.to_string()))?;
    let headers = request.headers_mut();
    headers.insert(
        "x-oyasumivr-pc",
        pc_id.parse().map_err(|_| WssError::Unauthorized)?,
    );
    headers.insert(
        "authorization",
        format!("Bearer {token}")
            .parse()
            .map_err(|_| WssError::Unauthorized)?,
    );

    // wait for the upgrade and the first message
    let handshake = tokio::time::timeout(Duration::from_secs(10), async {
        let (mut socket, _) = tokio_tungstenite::client_async(request, tls).await?;
        let hello = socket
            .next()
            .await
            .ok_or(tungstenite::Error::ConnectionClosed)??;
        Ok::<_, tungstenite::Error>((socket, hello))
    })
    .await;

    // map the result; the first message must be hello
    match handshake {
        Err(_) => Err(WssError::Unreachable),
        Ok(Err(tungstenite::Error::Http(response)))
            if response.status() == StatusCode::UNAUTHORIZED =>
        {
            Err(WssError::Unauthorized)
        }
        Ok(Err(tungstenite::Error::Io(_) | tungstenite::Error::ConnectionClosed)) => {
            Err(WssError::Unreachable)
        }
        Ok(Err(error)) => Err(WssError::Failed(error.to_string())),
        Ok(Ok((socket, Message::Text(text)))) => serde_json::from_str::<Hello>(&text)
            .map(|hello| (socket, hello))
            .map_err(|e| WssError::Failed(format!("unreadable hello: {e}"))),
        Ok(Ok(_)) => Err(WssError::Failed("the helper did not send a hello".into())),
    }
}

pub async fn close(mut socket: Socket) {
    let _ = socket.close(None).await;
}
