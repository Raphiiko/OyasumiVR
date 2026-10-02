use std::{
    io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use controls::{Control, FadeError, FadeReport, FadeRequest, Outcome};
use hub::{Action, Command, Event, Hub};

use futures_util::{SinkExt, StreamExt};
use rustls::{
    pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer},
    ServerConfig,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::tungstenite::{
    handshake::server::{ErrorResponse, Request, Response},
    http::StatusCode,
    protocol::WebSocketConfig,
    Message,
};

pub mod brightness;
pub mod cct;
#[path = "../../src-shared-rust/src/color_temperature.rs"]
pub mod color_temperature;
pub mod controls;
pub mod hub;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const PROTOCOL_MIN: u32 = 1;
pub const PROTOCOL_MAX: u32 = 1;

const PC_ID_HEADER: &str = "x-oyasumivr-pc";
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Deserialize)]
struct Config {
    port: u16,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub version: &'static str,
    pub protocol_min: u32,
    pub protocol_max: u32,
    /// SHA-256 of this process's executable, as lowercase hex. Empty when it cannot be read.
    pub digest: String,
}

/// Hashes `/proc/self/exe`, which still holds the running code after an update replaces the file.
pub fn info() -> Info {
    let executable = std::fs::read("/proc/self/exe")
        .or_else(|_| std::env::current_exe().and_then(std::fs::read));
    Info {
        version: VERSION,
        protocol_min: PROTOCOL_MIN,
        protocol_max: PROTOCOL_MAX,
        digest: executable
            .map(|bytes| {
                Sha256::digest(bytes)
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect()
            })
            .unwrap_or_default(),
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Identity {
    pub serial: String,
    pub model: String,
    pub manufacturer: String,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Outgoing<'a> {
    Brightness {
        #[serde(flatten)]
        snapshot: &'a brightness::Snapshot,
        #[serde(skip_serializing_if = "Option::is_none")]
        fade: Option<&'a FadeReport>,
    },
    Cct {
        #[serde(flatten)]
        snapshot: &'a cct::Snapshot,
        #[serde(skip_serializing_if = "Option::is_none")]
        fade: Option<&'a FadeReport>,
    },
    FadeResult {
        id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<FadeError>,
    },
    FadeEnded {
        control: Control,
        operation: &'a str,
        outcome: Outcome,
    },
    #[serde(rename_all = "camelCase")]
    SetBrightnessResult {
        id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        percentage: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<brightness::SetError>,
    },
    SetCctResult {
        id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        snapshot: Option<&'a cct::Snapshot>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<cct::SetError>,
    },
}

impl<'a> Outgoing<'a> {
    /// The message for one PC connection, or `None` for an event that belongs to another PC.
    fn of(event: &'a Event, connection: u64) -> Option<Self> {
        let own = |cause: &Option<u64>| *cause == Some(connection);
        Some(match event {
            Event::Brightness { cause, .. } | Event::Cct { cause, .. } if own(cause) => {
                return None
            }
            Event::BrightnessReply { connection: c, .. }
            | Event::CctReply { connection: c, .. }
            | Event::FadeReply { connection: c, .. }
                if *c != connection =>
            {
                return None
            }
            Event::Brightness { snapshot, fade, .. } => Self::Brightness {
                snapshot,
                fade: fade.as_ref(),
            },
            Event::Cct { snapshot, fade, .. } => Self::Cct {
                snapshot,
                fade: fade.as_ref(),
            },
            Event::FadeReply { id, result, .. } => Self::FadeResult {
                id: *id,
                error: result.err(),
            },
            Event::FadeEnded {
                control,
                operation,
                outcome,
            } => Self::FadeEnded {
                control: *control,
                operation,
                outcome: *outcome,
            },
            Event::BrightnessReply { id, result, .. } => Self::SetBrightnessResult {
                id: *id,
                percentage: result.ok(),
                error: result.as_ref().err().copied(),
            },
            Event::CctReply { id, result, .. } => Self::SetCctResult {
                id: *id,
                snapshot: result.as_ref().ok(),
                error: result.as_ref().err().copied(),
            },
        })
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Incoming {
    SetBrightness {
        id: u64,
        percentage: f64,
    },
    SetCct {
        id: u64,
        kelvin: i64,
    },
    #[serde(rename_all = "camelCase")]
    Fade {
        id: u64,
        control: Control,
        operation: String,
        target: f64,
        duration_ms: u64,
        simple: Option<SimpleCurve>,
    },
    CancelFade {
        operation: String,
    },
}

#[derive(Deserialize)]
struct SimpleCurve {
    from: f64,
    to: f64,
}

impl Incoming {
    /// The message id and action, or `None` for a message with values the helper cannot use.
    fn into_action(self) -> Option<(u64, Action)> {
        Some(match self {
            Self::SetBrightness { id, percentage } if percentage.is_finite() => {
                (id, Action::SetBrightness(percentage))
            }
            Self::SetCct { id, kelvin } => (id, Action::SetCct(kelvin)),
            Self::Fade {
                id,
                control,
                operation,
                target,
                duration_ms,
                simple,
            } if target.is_finite()
                && operation.len() <= 64
                && Duration::from_millis(duration_ms) <= controls::MAX_DURATION
                && simple
                    .as_ref()
                    .is_none_or(|curve| curve.from.is_finite() && curve.to.is_finite()) =>
            {
                let request = FadeRequest {
                    control,
                    operation,
                    target,
                    duration: Duration::from_millis(duration_ms),
                    simple: simple.map(|curve| (curve.from, curve.to)),
                };
                (id, Action::Fade(request))
            }
            Self::CancelFade { operation } => (0, Action::CancelFade(operation)),
            _ => return None,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Hello {
    r#type: &'static str,
    #[serde(flatten)]
    info: Info,
    identity: Option<Identity>,
}

/// Loads the helper's TLS identity from `tls/`, creating a new one when it is missing or unusable.
pub fn ensure_certificate(
    root: &Path,
) -> io::Result<(CertificateDer<'static>, PrivateKeyDer<'static>)> {
    let dir = root.join("tls");
    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");

    // reuse the stored identity when it still works
    if let Ok(identity) = load_certificate(&cert_path, &key_path) {
        return Ok(identity);
    }

    // otherwise generate a self-signed one
    let generated = rcgen::generate_simple_self_signed(vec!["oyasumivr-frame-helper".into()])
        .map_err(io::Error::other)?;

    // store it readable by this user only
    create_private_dir(&dir)?;
    write_private(&key_path, generated.signing_key.serialize_pem().as_bytes())?;
    write_private(&cert_path, generated.cert.pem().as_bytes())?;

    // read it back from disk
    load_certificate(&cert_path, &key_path)
}

/// Fails unless both files parse and the key belongs to the certificate.
fn load_certificate(
    cert_path: &Path,
    key_path: &Path,
) -> io::Result<(CertificateDer<'static>, PrivateKeyDer<'static>)> {
    let cert = CertificateDer::from_pem_file(cert_path).map_err(io::Error::other)?;
    let key = PrivateKeyDer::from_pem_file(key_path).map_err(io::Error::other)?;
    tls_config(cert.clone(), key.clone_key())?;
    Ok((cert, key))
}

fn tls_config(
    cert: CertificateDer<'static>,
    key: PrivateKeyDer<'static>,
) -> io::Result<ServerConfig> {
    ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .and_then(|builder| {
            builder
                .with_no_client_auth()
                .with_single_cert(vec![cert], key)
        })
        .map_err(io::Error::other)
}

fn create_private_dir(dir: &Path) -> io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Writes the file with mode 600 through a temporary file, so a crash never leaves half a file.
fn write_private(path: &Path, contents: &[u8]) -> io::Result<()> {
    let temp = path.with_extension("tmp");

    // open the temporary file with owner-only access
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    // write and flush it to disk
    let mut file = options.open(&temp)?;
    io::Write::write_all(&mut file, contents)?;
    file.sync_all()?;

    // swap it into place
    std::fs::rename(temp, path)
}

/// Reads the headset identity SteamVR last recorded. `None` when any of the three values is missing.
pub fn parse_identity(settings: &str) -> Option<Identity> {
    let settings: serde_json::Value = serde_json::from_str(settings).ok()?;
    let last_known = settings.get("LastKnown")?;
    let field = |key: &str| {
        last_known
            .get(key)?
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    Some(Identity {
        serial: field("HMDSerialNumber")?,
        model: field("HMDModel")?,
        manufacturer: field("HMDManufacturer")?,
    })
}

/// Reads the identity from this user's SteamVR settings file.
fn read_identity() -> Option<Identity> {
    let home = std::env::var_os("HOME")?;
    let path = Path::new(&home).join(".config/openvr/config/steamvr.vrsettings");
    parse_identity(&std::fs::read_to_string(path).ok()?)
}

/// The PC id names a token file, so it must stay a single safe path segment.
fn valid_pc_id(pc_id: &str) -> bool {
    (1..=64).contains(&pc_id.len())
        && pc_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Accepts a request only when its bearer token equals the token file for its PC.
fn authorized(root: &Path, request: &Request) -> bool {
    // read the PC id and bearer token headers
    let header = |name: &str| request.headers().get(name)?.to_str().ok();
    let (Some(pc_id), Some(token)) = (
        header(PC_ID_HEADER),
        header("authorization").and_then(|value| value.strip_prefix("Bearer ")),
    ) else {
        return false;
    };

    // reject ids that are not a safe file name
    if !valid_pc_id(pc_id) || token.is_empty() {
        return false;
    }

    // compare with that PC's token file
    std::fs::read_to_string(root.join("clients").join(pc_id))
        .is_ok_and(|expected| constant_time_eq(expected.trim().as_bytes(), token.as_bytes()))
}

fn unauthorized() -> ErrorResponse {
    let mut response = ErrorResponse::new(None);
    *response.status_mut() = StatusCode::UNAUTHORIZED;
    response
}

/// Serves one PC: TLS, token check, hello message, then brightness and color temperature until the
/// socket closes.
#[allow(clippy::result_large_err)] // the callback signature belongs to tungstenite
async fn handle(
    stream: TcpStream,
    acceptor: TlsAcceptor,
    root: Arc<PathBuf>,
    info: Arc<Info>,
    hub: Arc<Hub>,
    connection: u64,
) {
    // finish the TLS handshake
    let Ok(Ok(tls)) = tokio::time::timeout(HANDSHAKE_TIMEOUT, acceptor.accept(stream)).await else {
        return;
    };

    // upgrade to a websocket, only with a valid token
    let config = WebSocketConfig::default()
        .max_message_size(Some(64 << 10))
        .max_frame_size(Some(64 << 10));
    let callback = |request: &Request, response: Response| {
        if authorized(&root, request) {
            Ok(response)
        } else {
            Err(unauthorized())
        }
    };
    let accept = tokio_tungstenite::accept_hdr_async_with_config(tls, callback, Some(config));
    let Ok(Ok(mut socket)) = tokio::time::timeout(HANDSHAKE_TIMEOUT, accept).await else {
        return;
    };

    // send the version and headset identity, then the current brightness and color temperature
    let hello = Hello {
        r#type: "hello",
        info: (*info).clone(),
        identity: read_identity(),
    };
    let (latest, mut events) = hub.subscribe();
    for message in [
        serde_json::to_string(&hello),
        serde_json::to_string(&Outgoing::Brightness {
            snapshot: &latest.brightness,
            fade: latest.brightness_fade.as_ref(),
        }),
        serde_json::to_string(&Outgoing::Cct {
            snapshot: &latest.cct,
            fade: latest.cct_fade.as_ref(),
        }),
    ] {
        let Ok(message) = message else { return };
        if socket.send(Message::text(message)).await.is_err() {
            return;
        }
    }

    // pass commands to the headset task, and its events back, until either side stops
    loop {
        let event = tokio::select! {
            message = socket.next() => match message {
                Some(Ok(Message::Text(text))) => {
                    let parsed = serde_json::from_str::<Incoming>(&text).ok().and_then(Incoming::into_action);
                    let Some((id, action)) = parsed else { continue };
                    hub.send(Command { connection, id, action });
                    continue;
                }
                Some(Ok(message)) if !message.is_close() => continue,
                _ => return,
            },
            // a lagging PC reconnects and starts from a fresh snapshot
            event = events.recv() => match event {
                Ok(event) => event,
                Err(_) => return,
            },
        };
        let Some(message) = Outgoing::of(&event, connection) else {
            continue;
        };
        let Ok(message) = serde_json::to_string(&message) else {
            return;
        };
        if socket.send(Message::text(message)).await.is_err() {
            return;
        }
    }
}

/// Reads `config.json`, loads the TLS identity, and binds the configured port.
pub async fn bind(root: &Path) -> io::Result<(TcpListener, TlsAcceptor)> {
    let config: Config = serde_json::from_slice(&std::fs::read(root.join("config.json"))?)
        .map_err(io::Error::other)?;
    let (cert, key) = ensure_certificate(root)?;
    let tls = tls_config(cert, key)?;
    let listener = TcpListener::bind(("0.0.0.0", config.port)).await?;
    Ok((listener, TlsAcceptor::from(Arc::new(tls))))
}

/// Accepts connections forever, one task per connection.
pub async fn serve(
    root: PathBuf,
    listener: TcpListener,
    acceptor: TlsAcceptor,
    hub: Arc<Hub>,
) -> io::Result<()> {
    let root = Arc::new(root);
    let info = Arc::new(info());
    let next_connection = AtomicU64::new(1);
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let connection = next_connection.fetch_add(1, Ordering::Relaxed);
                tokio::spawn(handle(
                    stream,
                    acceptor.clone(),
                    root.clone(),
                    info.clone(),
                    hub.clone(),
                    connection,
                ));
            }
            Err(error) => {
                eprintln!("accept failed: {error}");
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests;
