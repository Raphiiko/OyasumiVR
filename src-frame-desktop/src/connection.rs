use crate::{Error, Result};
use futures_util::{SinkExt, StreamExt};
use oyasumivr_frame_protocol::{
    Command, Protocol, Reply, ReplyResult, Request, SteamVrState, MAX_MESSAGE_BYTES, PROTOCOL,
};
use std::{sync::Arc, time::Duration};
use tokio::{net::TcpStream, time::timeout};
use tokio_rustls::{
    client::TlsStream,
    rustls::{
        self,
        pki_types::{CertificateDer, ServerName},
    },
    TlsConnector,
};
use tokio_tungstenite::{
    tungstenite::{client::IntoClientRequest, protocol::WebSocketConfig, Message},
    WebSocketStream,
};

pub struct Connection {
    socket: WebSocketStream<TlsStream<TcpStream>>,
    sequence: u64,
    pub build: String,
    pub protocol: Protocol,
    pub steamvr: SteamVrState,
}

impl Connection {
    pub async fn connect(
        address: &str,
        port: u16,
        certificate: &[u8],
        server_name: &str,
        token: &str,
        device: &str,
        daemon: &str,
    ) -> Result<Self> {
        crate::onboarding::validate_address(address)?;
        if port == 0 || token.len() < 32 || token.len() > 256 || token.chars().any(char::is_control)
        {
            return Err(Error::InvalidInput);
        }
        timeout(Duration::from_secs(10), async {
            let mut roots = rustls::RootCertStore::empty();
            roots
                .add(CertificateDer::from(certificate.to_vec()))
                .map_err(|_| Error::CertificateChanged)?;
            let config = rustls::ClientConfig::builder_with_provider(Arc::new(
                rustls::crypto::ring::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .map_err(|_| Error::CertificateChanged)?
            .with_root_certificates(roots)
            .with_no_client_auth();
            let tcp = TcpStream::connect((address, port))
                .await
                .map_err(|_| Error::Offline)?;
            let tls = TlsConnector::from(Arc::new(config))
                .connect(
                    ServerName::try_from(server_name.to_owned())
                        .map_err(|_| Error::InvalidInput)?,
                    tcp,
                )
                .await
                .map_err(|error| {
                    match error
                        .get_ref()
                        .and_then(|error| error.downcast_ref::<rustls::Error>())
                    {
                        Some(
                            rustls::Error::InvalidCertificate(_)
                            | rustls::Error::NoCertificatesPresented,
                        ) => Error::CertificateChanged,
                        Some(_) => Error::ProtocolMismatch,
                        None => Error::Offline,
                    }
                })?;
            if tls
                .get_ref()
                .1
                .peer_certificates()
                .and_then(|chain| chain.first())
                .map(|c| c.as_ref())
                != Some(certificate)
            {
                return Err(Error::CertificateChanged);
            }
            let mut request = "wss://oyasumivr-frame-companion/companion"
                .into_client_request()
                .map_err(|_| Error::InvalidInput)?;
            let mut authorization = tokio_tungstenite::tungstenite::http::HeaderValue::from_str(
                &format!("Bearer {token}"),
            )
            .map_err(|_| Error::InvalidInput)?;
            authorization.set_sensitive(true);
            request.headers_mut().insert("authorization", authorization);
            let config = WebSocketConfig::default()
                .max_message_size(Some(MAX_MESSAGE_BYTES))
                .max_frame_size(Some(MAX_MESSAGE_BYTES));
            let (socket, _) =
                tokio_tungstenite::client_async_with_config(request, tls, Some(config))
                    .await
                    .map_err(|e| match e {
                        tokio_tungstenite::tungstenite::Error::Http(response)
                            if response.status() == 401 =>
                        {
                            Error::CompanionAuthenticationFailed
                        }
                        tokio_tungstenite::tungstenite::Error::Http(response)
                            if response.status() == 409 =>
                        {
                            Error::Busy
                        }
                        _ => Error::Offline,
                    })?;
            let mut connection = Self {
                socket,
                sequence: 0,
                build: String::new(),
                protocol: PROTOCOL,
                steamvr: SteamVrState::Unavailable,
            };
            match connection
                .exchange(Command::Hello {
                    protocol: PROTOCOL,
                    expected_device_id: device.into(),
                    expected_daemon_id: daemon.into(),
                })
                .await?
            {
                ReplyResult::Hello {
                    protocol,
                    build_version,
                    device_id,
                    daemon_id,
                    capabilities,
                    steamvr,
                } => {
                    if device_id != device || daemon_id != daemon {
                        return Err(Error::WrongDevice);
                    }
                    if protocol.major != PROTOCOL.major
                        || protocol.minor > PROTOCOL.minor
                        || capabilities != ["status"]
                    {
                        return Err(Error::ProtocolMismatch);
                    }
                    connection.build = build_version;
                    connection.protocol = protocol;
                    connection.steamvr = steamvr;
                }
                ReplyResult::Error {
                    code: oyasumivr_frame_protocol::ProtocolError::WrongIdentity,
                } => return Err(Error::WrongDevice),
                _ => return Err(Error::ProtocolMismatch),
            }
            connection.status().await?;
            Ok(connection)
        })
        .await
        .map_err(|_| Error::Timeout)?
    }

    async fn exchange(&mut self, command: Command) -> Result<ReplyResult> {
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or(Error::ProtocolMismatch)?;
        let id = self.sequence;
        let message =
            serde_json::to_string(&Request { id, command }).map_err(|_| Error::InvalidInput)?;
        if message.len() > MAX_MESSAGE_BYTES {
            return Err(Error::InvalidInput);
        }
        timeout(Duration::from_secs(5), async {
            self.socket
                .send(Message::Text(message.into()))
                .await
                .map_err(|_| Error::Offline)?;
            loop {
                match self.socket.next().await {
                    Some(Ok(Message::Text(text))) => {
                        let reply: Reply =
                            serde_json::from_str(&text).map_err(|_| Error::ProtocolMismatch)?;
                        if reply.id != id {
                            return Err(Error::ProtocolMismatch);
                        }
                        return Ok(reply.result);
                    }
                    Some(Ok(Message::Ping(_))) => {
                        self.socket.flush().await.map_err(|_| Error::Offline)?
                    }
                    _ => return Err(Error::Offline),
                }
            }
        })
        .await
        .map_err(|_| Error::Timeout)?
    }

    pub async fn status(&mut self) -> Result<SteamVrState> {
        if let ReplyResult::Status { steamvr } = self.exchange(Command::GetStatus).await? {
            self.steamvr = steamvr;
            Ok(steamvr)
        } else {
            Err(Error::ProtocolMismatch)
        }
    }

    pub async fn close(mut self) {
        let _ = timeout(Duration::from_secs(2), self.socket.close(None)).await;
    }
}
