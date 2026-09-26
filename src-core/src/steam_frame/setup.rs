use std::{sync::LazyLock, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine};
use log::{info, warn};
use rustls::pki_types::{pem::PemObject, CertificateDer};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::{
    hex,
    models::{
        CleanupOutcome, CleanupRequest, Identity, SetupOutcome, SetupRequest, SetupResult, Stage,
    },
    ssh::{self, Session, SshError},
    valid_pc_id,
    wss::{self, Hello, WssError},
    HELPER_PATH, HELPER_PORT, PROTOCOL_VERSION,
};

const SCRIPT: &str = include_str!("helper.sh");
const UNINSTALL: &str = include_str!("uninstall.sh");
pub(super) const EXIT_BUSY: u32 = 75;
pub(super) const EXIT_MISSING: u32 = 69;
const EXIT_DIGEST: u32 = 65;
pub(super) const EXIT_CHANGED: u32 = 73;

pub const BUNDLED_VERSION: &str = env!("CARGO_PKG_VERSION");
static BUNDLED_DIGEST: LazyLock<Option<String>> =
    LazyLock::new(|| Some(hex(&Sha256::digest(std::fs::read(HELPER_PATH).ok()?))));

/// SHA-256 of the helper this build carries. `None` when the build skipped the helper.
pub fn bundled_digest() -> Option<&'static str> {
    BUNDLED_DIGEST.as_deref()
}

/// Builds the remote command for one script step. The script travels base64 encoded, so the
/// login shell never has to parse its quoting.
fn command(arguments: &[&str]) -> String {
    let mut command = format!(
        "bash -c \"$(printf %s {} | base64 -d)\" helper.sh",
        STANDARD.encode(SCRIPT)
    );
    for argument in arguments {
        command.push(' ');
        command.push_str(argument);
    }
    command
}

/// True for an argument the remote shell passes through unchanged.
fn plain_word(argument: &str) -> bool {
    !argument.is_empty()
        && argument
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-._".contains(&b))
}

/// Runs one `helper.sh` step over SSH, refusing any argument that needs quoting.
pub(super) async fn run(
    session: &Session,
    arguments: &[&str],
    stdin: &[u8],
) -> Result<ssh::Output, SshError> {
    if !arguments.iter().all(|argument| plain_word(argument)) {
        return Err(SshError::Failed(format!(
            "unsafe script arguments: {arguments:?}"
        )));
    }
    session.exec(&command(arguments), stdin).await
}

#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HelperInfo {
    pub version: String,
    pub protocol_min: u32,
    pub protocol_max: u32,
    #[serde(default)]
    pub digest: Option<String>,
}

impl HelperInfo {
    pub fn accepts(&self, protocol: u32) -> bool {
        (self.protocol_min..=self.protocol_max).contains(&protocol)
    }
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum InstallDecision {
    Install,
    /// Same version as the bundled helper, but a different executable.
    Repair,
    Reuse,
    NeedsAppUpdate,
}

/// Decides what to do with the helper already on the headset. A newer helper is never replaced,
/// and an unreadable version counts as older.
pub fn install_decision(
    installed: Option<&HelperInfo>,
    bundled: &str,
    bundled_digest: Option<&str>,
    protocol: u32,
) -> InstallDecision {
    // nothing installed yet
    let Some(installed) = installed else {
        return InstallDecision::Install;
    };
    // an unreadable version gets replaced
    let (Ok(installed_version), Ok(bundled_version)) = (
        semver::Version::parse(&installed.version),
        semver::Version::parse(bundled),
    ) else {
        return InstallDecision::Install;
    };
    // older is replaced, same version kept or repaired, compatible newer kept
    if installed_version < bundled_version {
        InstallDecision::Install
    } else if installed_version == bundled_version {
        if bundled_digest.is_some_and(|digest| installed.digest.as_deref() != Some(digest)) {
            InstallDecision::Repair
        } else {
            InstallDecision::Reuse
        }
    } else if installed.accepts(protocol) {
        InstallDecision::Reuse
    } else {
        InstallDecision::NeedsAppUpdate
    }
}

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

/// Returns the SHA-256 of the certificate's DER encoding, as lowercase hex.
pub fn certificate_pin(pem: &str) -> Option<String> {
    let certificate = CertificateDer::from_pem_slice(pem.as_bytes()).ok()?;
    Some(hex(&Sha256::digest(certificate.as_ref())))
}

pub struct Provisioned {
    pub port: u16,
    pub cert_pin: String,
}

#[derive(Deserialize)]
struct Config {
    port: u16,
}

#[derive(Debug, PartialEq)]
pub enum ProvisionError {
    HelperMissing,
    Busy,
    Ssh(SshError),
    Failed(String),
}

/// Writes this PC's token and public key files, starts the helper, and reads its port and
/// certificate.
pub async fn provision(
    session: &Session,
    pc_id: &str,
    token: &str,
    public_key: &str,
) -> Result<Provisioned, ProvisionError> {
    // write the token and key files, start the helper
    let stdin = format!(
        "{token}
{public_key}
"
    );
    let output = run(session, &["provision", pc_id], stdin.as_bytes())
        .await
        .map_err(ProvisionError::Ssh)?;
    match output.status {
        0 => {}
        EXIT_MISSING => return Err(ProvisionError::HelperMissing),
        EXIT_BUSY => return Err(ProvisionError::Busy),
        status => {
            return Err(ProvisionError::Failed(format!(
                "provisioning exited with {status}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )))
        }
    }
    // first line holds the port, the rest the certificate
    let stdout = output.stdout();
    let (config, certificate) = stdout.split_once('\n').unwrap_or((&stdout, ""));
    let config: Config = serde_json::from_str(config)
        .map_err(|e| ProvisionError::Failed(format!("unreadable helper config: {e}")))?;
    let cert_pin = certificate_pin(certificate)
        .ok_or_else(|| ProvisionError::Failed("unreadable helper certificate".into()))?;
    Ok(Provisioned {
        port: config.port,
        cert_pin,
    })
}

#[derive(Debug, PartialEq)]
pub enum InstallError {
    /// The helper folder is absent, and this call may not create it.
    Missing,
    Busy,
    /// The uploaded executable did not match the bundled digest.
    Corrupted,
    Ssh(SshError),
    Failed(String),
}

impl From<SshError> for InstallError {
    fn from(error: SshError) -> Self {
        InstallError::Ssh(error)
    }
}

pub struct Inspected {
    pub installed: Option<HelperInfo>,
    pub decision: InstallDecision,
    /// Whether this call installed the bundled helper.
    pub replaced: bool,
}

/// Installs the bundled helper when the installed one needs it, deciding again when another PC
/// changed the helper meanwhile. `repair` also replaces a helper of the bundled version, and
/// `fresh` allows creating a missing helper folder.
pub async fn install_bundled(
    session: &Session,
    repair: bool,
    fresh: bool,
) -> Result<Inspected, InstallError> {
    for _ in 0..3 {
        let inspect = run(session, &["inspect"], b"").await?.stdout();
        let installed: Option<HelperInfo> = serde_json::from_str(inspect.trim()).unwrap_or(None);
        if installed.is_none()
            && !fresh
            && run(session, &["present"], b"").await?.status == EXIT_MISSING
        {
            return Err(InstallError::Missing);
        }
        let mut decision = install_decision(
            installed.as_ref(),
            BUNDLED_VERSION,
            bundled_digest(),
            PROTOCOL_VERSION,
        );
        if repair
            && decision == InstallDecision::Reuse
            && installed
                .as_ref()
                .is_some_and(|info| info.version == BUNDLED_VERSION)
        {
            decision = InstallDecision::Repair;
        }
        if !matches!(decision, InstallDecision::Install | InstallDecision::Repair) {
            return Ok(Inspected {
                installed,
                decision,
                replaced: false,
            });
        }
        let helper = std::fs::read(HELPER_PATH)
            .map_err(|e| InstallError::Failed(format!("the bundled helper is missing: {e}")))?;
        let digest = hex(&Sha256::digest(&helper));
        let port = HELPER_PORT.to_string();
        let seen = hex(&Sha256::digest(inspect.trim().as_bytes()));
        let output = run(
            session,
            &["install", BUNDLED_VERSION, &digest, &port, &seen],
            &helper,
        )
        .await?;
        match output.status {
            0 => {
                write_uninstaller(session).await?;
                return Ok(Inspected {
                    installed,
                    decision,
                    replaced: true,
                });
            }
            EXIT_CHANGED => continue,
            EXIT_BUSY => return Err(InstallError::Busy),
            EXIT_DIGEST => return Err(InstallError::Corrupted),
            status => {
                return Err(InstallError::Failed(format!(
                    "installation exited with {status}: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                )))
            }
        }
    }
    Err(InstallError::Busy)
}

async fn write_uninstaller(session: &Session) -> Result<(), InstallError> {
    let output = run(session, &["uninstaller"], UNINSTALL.as_bytes()).await?;
    if output.status == 0 {
        Ok(())
    } else {
        Err(InstallError::Failed(
            "could not write the uninstall script".into(),
        ))
    }
}

impl From<SshError> for SetupOutcome {
    fn from(error: SshError) -> Self {
        match error {
            SshError::Unreachable => SetupOutcome::Unreachable,
            SshError::HostKeyChanged => SetupOutcome::HostKeyChanged,
            SshError::Rejected => SetupOutcome::Rejected,
            SshError::Failed(message) => SetupOutcome::Failed { message },
        }
    }
}

/// Verifies the headset, installs or reuses the helper, and completes only after an
/// authenticated WSS handshake. Every step is safe to repeat, which is what Resume relies on.
pub async fn setup(request: SetupRequest, on_stage: impl Fn(Stage)) -> SetupResult {
    let mut installed = false;
    let outcome = match run_setup(&request, &on_stage, &mut installed).await {
        Ok(outcome) | Err(outcome) => outcome,
    };
    info!("[SteamFrame] Setup finished: {outcome:?}");
    SetupResult { outcome, installed }
}

/// Checks the request, then runs the setup steps in one SSH session.
async fn run_setup(
    request: &SetupRequest,
    on_stage: &impl Fn(Stage),
    installed: &mut bool,
) -> Result<SetupOutcome, SetupOutcome> {
    // refuse requests that setup cannot run safely
    if !valid_pc_id(&request.pc_id) {
        return Err(SetupOutcome::Failed {
            message: "invalid PC id".into(),
        });
    }
    if request.access.host_key_pin.is_none() {
        return Err(SetupOutcome::Failed {
            message: "setup needs a pinned host key".into(),
        });
    }
    if !request.identity.is_supported() {
        return Err(SetupOutcome::Failed {
            message: "this headset model is not supported".into(),
        });
    }
    // run every step in one session
    let session = ssh::connect(&request.access).await?;
    let result = setup_session(request, &session, on_stage, installed).await;
    // a failed reinstall removes the helper it installed
    if result.is_err() && *installed && request.remove_on_failure {
        match run(&session, &["uninstall_helper"], b"").await {
            Ok(output) if output.status == 0 => *installed = false,
            Ok(output) => warn!(
                "[SteamFrame] Removing the helper after a failed install exited with {}",
                output.status
            ),
            Err(error) => {
                warn!("[SteamFrame] Could not remove the helper after a failed install: {error:?}")
            }
        }
    }
    session.close().await;
    result
}

/// The setup steps: verify the headset, install the helper, provision, and handshake.
async fn setup_session(
    request: &SetupRequest,
    session: &Session,
    on_stage: &impl Fn(Stage),
    installed: &mut bool,
) -> Result<SetupOutcome, SetupOutcome> {
    let failed = |message: String| SetupOutcome::Failed { message };

    // verify: the headset is the one SteamVR reported
    on_stage(Stage::Verify);
    let settings = run(session, &["identity"], b"").await?.stdout();
    match parse_identity(&settings) {
        None => return Err(SetupOutcome::IdentityMissing),
        Some(identity) if identity != request.identity => {
            warn!(
                "[SteamFrame] Headset identity {identity:?} differs from {:?}",
                request.identity
            );
            return Err(SetupOutcome::WrongDevice);
        }
        Some(_) => {}
    }

    // install: compare the installed helper with the bundled one
    on_stage(Stage::Install);
    let inspected = install_bundled(session, false, true)
        .await
        .map_err(|error| match error {
            InstallError::Busy => SetupOutcome::HelperBusy,
            InstallError::Ssh(error) => error.into(),
            error => failed(format!("{error:?}")),
        })?;
    // stop on an incompatible helper, else keep its uninstall script current
    match inspected.decision {
        InstallDecision::NeedsAppUpdate => {
            return Err(SetupOutcome::NeedsAppUpdate {
                helper_version: inspected
                    .installed
                    .map(|info| info.version)
                    .unwrap_or_default(),
            })
        }
        _ if inspected.replaced => {
            *installed = true;
            on_stage(Stage::Installed);
        }
        _ if inspected
            .installed
            .as_ref()
            .is_some_and(|info| info.version == BUNDLED_VERSION) =>
        {
            write_uninstaller(session)
                .await
                .map_err(|_| failed("could not write the uninstall script".into()))?;
        }
        _ => {}
    }

    // connection: give this PC a token, start the helper
    on_stage(Stage::Connection);
    let provisioned = provision(session, &request.pc_id, &request.token, &request.public_key)
        .await
        .map_err(|error| match error {
            ProvisionError::Ssh(error) => error.into(),
            ProvisionError::HelperMissing => failed("the helper is not installed".into()),
            ProvisionError::Busy => SetupOutcome::HelperBusy,
            ProvisionError::Failed(message) => failed(message),
        })?;
    // prove it works with an authenticated handshake
    let hello = handshake(request, &provisioned).await?;
    // the running helper must speak our protocol and version
    if !hello.info.accepts(PROTOCOL_VERSION) {
        return Err(SetupOutcome::NeedsAppUpdate {
            helper_version: hello.info.version,
        });
    }
    if *installed && hello.info.version != BUNDLED_VERSION {
        return Err(failed(format!(
            "the helper reports version {} after installing {BUNDLED_VERSION}",
            hello.info.version
        )));
    }
    Ok(SetupOutcome::Complete {
        cert_pin: provisioned.cert_pin,
        port: provisioned.port,
        helper_version: hello.info.version,
    })
}

/// Retries while a freshly started helper is still binding its port, for at most 30 seconds so
/// the SSH session is still open for cleanup afterwards.
async fn handshake(
    request: &SetupRequest,
    provisioned: &Provisioned,
) -> Result<Hello, SetupOutcome> {
    tokio::time::timeout(
        Duration::from_secs(30),
        retry_handshake(request, provisioned),
    )
    .await
    .unwrap_or_else(|_| {
        Err(SetupOutcome::Failed {
            message: "the helper handshake timed out".into(),
        })
    })
}

async fn retry_handshake(
    request: &SetupRequest,
    provisioned: &Provisioned,
) -> Result<Hello, SetupOutcome> {
    let mut attempt = 0;
    loop {
        let result = wss::connect(
            &request.access.address,
            provisioned.port,
            &provisioned.cert_pin,
            &request.pc_id,
            &request.token,
        )
        .await;
        match result {
            Ok((socket, hello)) => {
                wss::close(socket).await;
                return Ok(hello);
            }
            Err(WssError::Unreachable) if attempt < 20 => {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            Err(error) => {
                return Err(SetupOutcome::Failed {
                    message: format!("the helper handshake failed: {error:?}"),
                })
            }
        }
    }
}

/// Removes this PC's token file and key lines, and the helper when this attempt installed it
/// and no other PC has a token file.
pub async fn cleanup(request: CleanupRequest) -> CleanupOutcome {
    // refuse an id that is not a safe file name
    if !valid_pc_id(&request.pc_id) {
        return CleanupOutcome::Failed {
            message: "invalid PC id".into(),
        };
    }
    // a rejected login means our access is already gone
    let session = match ssh::connect(&request.access).await {
        Ok(session) => session,
        Err(SshError::Rejected) => return CleanupOutcome::Done,
        Err(SshError::Unreachable) => return CleanupOutcome::Unreachable,
        Err(SshError::HostKeyChanged) => return CleanupOutcome::HostKeyChanged,
        Err(SshError::Failed(message)) => return CleanupOutcome::Failed { message },
    };
    // remove token file, key line, and maybe the helper
    let remove_helper = if request.remove_helper { "1" } else { "0" };
    let result = run(
        &session,
        &["cleanup", &request.pc_id, remove_helper],
        request.public_key.as_bytes(),
    )
    .await;
    session.close().await;
    // map the exit status to an outcome
    match result {
        Ok(output) if output.status == 0 => CleanupOutcome::Done,
        Ok(output) if output.status == EXIT_BUSY => CleanupOutcome::HelperBusy,
        Ok(output) => CleanupOutcome::Failed {
            message: format!("cleanup exited with {}", output.status),
        },
        Err(error) => CleanupOutcome::Failed {
            message: format!("{error:?}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(version: &str, min: u32, max: u32) -> HelperInfo {
        HelperInfo {
            version: version.into(),
            protocol_min: min,
            protocol_max: max,
            digest: Some("aaaa".into()),
        }
    }

    #[test]
    fn install_decision_follows_compatibility_rows() {
        use InstallDecision::*;
        let decide = |installed: Option<&HelperInfo>| {
            install_decision(installed, "26.10.0", Some("aaaa"), 1)
        };
        assert_eq!(decide(None), Install);
        assert_eq!(decide(Some(&info("26.9.0", 1, 1))), Install);
        assert_eq!(decide(Some(&info("26.10.0-beta.3", 1, 1))), Install);
        assert_eq!(decide(Some(&info("garbage", 1, 1))), Install);
        assert_eq!(decide(Some(&info("26.10.0", 1, 1))), Reuse);
        assert_eq!(decide(Some(&info("26.11.0", 1, 2))), Reuse);
        assert_eq!(decide(Some(&info("26.11.0", 2, 3))), NeedsAppUpdate);
    }

    #[test]
    fn same_version_with_other_files_is_repaired() {
        use InstallDecision::*;
        let mut changed = info("26.10.0", 1, 1);
        changed.digest = Some("bbbb".into());
        assert_eq!(
            install_decision(Some(&changed), "26.10.0", Some("aaaa"), 1),
            Repair
        );
        changed.digest = None;
        assert_eq!(
            install_decision(Some(&changed), "26.10.0", Some("aaaa"), 1),
            Repair
        );
        // a newer helper keeps its own files
        let mut newer = info("26.11.0", 1, 1);
        newer.digest = Some("bbbb".into());
        assert_eq!(
            install_decision(Some(&newer), "26.10.0", Some("aaaa"), 1),
            Reuse
        );
        // a build without the helper has nothing to repair with
        assert_eq!(install_decision(Some(&changed), "26.10.0", None, 1), Reuse);
    }

    #[test]
    fn identity_matches_exactly() {
        let settings = |serial: &str| {
            format!(
                r#"{{"LastKnown":{{"HMDSerialNumber":"{serial}","HMDModel":"Deckard DV2","HMDManufacturer":"Valve","ActualHMDDriver":"cv"}}}}"#
            )
        };
        let expected = Identity {
            serial: "FPTEST000001".into(),
            model: "Deckard DV2".into(),
            manufacturer: "Valve".into(),
        };
        assert_eq!(
            parse_identity(&settings("FPTEST000001")),
            Some(expected.clone())
        );
        for serial in [
            "cv.FPTEST000001",
            "fptest000001",
            "FPTEST000001 ",
            "FPTEST000002",
        ] {
            assert_ne!(
                parse_identity(&settings(serial)),
                Some(expected.clone()),
                "{serial}"
            );
        }
        assert_eq!(parse_identity(&settings("")), None);
        assert_eq!(parse_identity(""), None);
        assert_eq!(parse_identity(r#"{"steamvr":{}}"#), None);
    }

    #[test]
    fn script_arguments_are_plain_words() {
        let command = command(&["provision", "3f2a-11"]);
        assert!(command.starts_with("bash -c \"$(printf %s "));
        assert!(command.ends_with(" | base64 -d)\" helper.sh provision 3f2a-11"));
        assert!(plain_word("26.9.0-beta.14"));
        for unsafe_word in ["", "a b", "$(x)", "a;b", "../x/y", "a'b"] {
            assert!(!plain_word(unsafe_word), "{unsafe_word}");
        }
    }
}
