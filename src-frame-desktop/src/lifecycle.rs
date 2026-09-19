use crate::{ssh::Session, Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

pub const SCRIPT: &[u8] = include_bytes!("../../src-frame-companion/lifecycle.sh");
pub const UNINSTALLER: &[u8] = include_bytes!("../../src-frame-companion/standalone-uninstall.sh");

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub schema: u8,
    pub build_version: String,
    pub architecture: String,
    pub protocol_major: u16,
    pub protocol_minor: u16,
    pub artifact_sha256: String,
    pub uninstaller_sha256: String,
}

pub struct Bundle {
    pub manifest: Manifest,
    pub artifact: Vec<u8>,
}

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

impl Bundle {
    pub fn read(directory: &Path) -> Result<Self> {
        for (name, limit) in [
            ("bundle.json", 16384),
            ("oyasumivr-frame-companion", 134217728),
        ] {
            let metadata =
                fs::metadata(directory.join(name)).map_err(|_| Error::ArtifactUnavailable)?;
            if !metadata.is_file() || metadata.len() == 0 || metadata.len() > limit {
                return Err(Error::ArtifactUnavailable);
            }
        }
        let manifest: Manifest = serde_json::from_slice(
            &fs::read(directory.join("bundle.json")).map_err(|_| Error::ArtifactUnavailable)?,
        )
        .map_err(|_| Error::ArtifactUnavailable)?;
        let artifact = fs::read(directory.join("oyasumivr-frame-companion"))
            .map_err(|_| Error::ArtifactUnavailable)?;
        if manifest.schema != 1
            || manifest.protocol_major != 1
            || manifest.protocol_minor != 1
            || !matches!(manifest.architecture.as_str(), "x86_64" | "aarch64")
            || semver::Version::parse(&manifest.build_version).is_err()
            || manifest.artifact_sha256 != digest(&artifact)
            || manifest.uninstaller_sha256 != digest(UNINSTALLER)
            || artifact.get(..6) != Some(b"\x7fELF\x02\x01")
            || artifact.get(18..20)
                != Some(if manifest.architecture == "aarch64" {
                    &[183, 0]
                } else {
                    &[62, 0]
                })
        {
            return Err(Error::ArtifactUnavailable);
        }
        Ok(Self { manifest, artifact })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Inspection {
    pub installation: String,
    pub service: String,
    pub installed_version: Option<String>,
    pub running_version: Option<String>,
    pub pairing_id: Option<String>,
    pub device_id: Option<String>,
    pub daemon_id: Option<String>,
    pub transaction_phase: Option<String>,
    pub architecture: String,
}

pub async fn invoke(session: &Session, args: &[&str]) -> Result<serde_json::Value> {
    let mut command = vec!["bash", "-s", "--"];
    command.extend_from_slice(args);
    let output = session.execute(&command, SCRIPT).await?;
    serde_json::from_slice(&output).map_err(|_| Error::RemoteOperation)
}

pub async fn invoke_owned(
    session: &Session,
    args: &[&str],
    pairing: &str,
    device: &str,
) -> Result<serde_json::Value> {
    if !matches!(args.first(), Some(&"recover" | &"uninstall")) {
        return Err(Error::InvalidInput);
    }
    let pairing = format!("OYASUMIVR_EXPECTED_PAIRING={pairing}");
    let device = format!("OYASUMIVR_EXPECTED_DEVICE={device}");
    let mut command = vec!["env", &pairing, &device, "bash", "-s", "--"];
    command.extend_from_slice(args);
    serde_json::from_slice(&session.execute(&command, SCRIPT).await?)
        .map_err(|_| Error::RemoteOperation)
}

pub async fn inspect(session: &Session, root: &str, unit: &str) -> Result<Inspection> {
    let inspection: Inspection =
        serde_json::from_value(invoke(session, &["inspect", root, unit]).await?)
            .map_err(|_| Error::RemoteOperation)?;
    if !matches!(
        inspection.installation.as_str(),
        "absent" | "unowned" | "managed" | "missing_or_broken_binary" | "interrupted_transaction"
    ) || !matches!(
        inspection.service.as_str(),
        "missing" | "unavailable" | "stopped" | "failed" | "broken" | "running"
    ) {
        return Err(Error::RemoteOperation);
    }
    Ok(inspection)
}

pub fn verify_owner(
    inspection: &Inspection,
    pairing: &str,
    device: &str,
    daemon: &str,
) -> Result<()> {
    if inspection.installation == "absent" {
        return Ok(());
    }
    if inspection.pairing_id.as_deref() != Some(pairing)
        || inspection.device_id.as_deref() != Some(device)
        || inspection
            .daemon_id
            .as_deref()
            .is_some_and(|id| id != daemon)
    {
        return Err(Error::WrongDevice);
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
pub enum Maintenance {
    Use,
    Update,
    RepairNeeded,
    Recover,
    UserAction,
}

pub fn policy(inspection: &Inspection, bundled: &Manifest, completed: bool) -> Result<Maintenance> {
    if inspection.transaction_phase.is_some() {
        return Ok(Maintenance::Recover);
    }
    if completed && inspection.installation == "absent" {
        return Ok(Maintenance::RepairNeeded);
    }
    if inspection.installation == "unowned" {
        return Err(Error::WrongDevice);
    }
    if inspection.installation == "missing_or_broken_binary"
        || matches!(inspection.service.as_str(), "broken" | "failed")
    {
        return Ok(Maintenance::RepairNeeded);
    }
    let Some(installed) = &inspection.installed_version else {
        return Ok(Maintenance::Update);
    };
    let installed = semver::Version::parse(installed).map_err(|_| Error::ProtocolMismatch)?;
    let bundled =
        semver::Version::parse(&bundled.build_version).map_err(|_| Error::ArtifactUnavailable)?;
    Ok(if installed < bundled {
        Maintenance::Update
    } else {
        Maintenance::Use
    })
}

pub async fn upload(session: &Session, path: &str, bytes: &[u8]) -> Result<()> {
    session
        .execute(
            &[
                "bash",
                "-c",
                "umask 077; set -o noclobber; cat > \"$1\"",
                "upload",
                path,
            ],
            bytes,
        )
        .await?;
    Ok(())
}

pub async fn remove_owned_key(session: &Session, public_key: &str) -> Result<()> {
    let fields: Vec<_> = public_key.split_whitespace().collect();
    if fields.len() != 3 || fields[0] != "ssh-rsa" {
        return Err(Error::InvalidInput);
    }
    let script = br#"import os, pathlib, sys, tempfile
path = pathlib.Path.home() / '.ssh' / 'authorized_keys'
if path.is_symlink():
    raise SystemExit(1)
try:
    original = path.read_bytes()
except FileNotFoundError:
    raise SystemExit(0)
key = sys.argv[1].encode()
kept = b''.join(line for line in original.splitlines(keepends=True) if line.split()[:2] != [b'ssh-rsa', key])
if kept != original:
    fd, temporary = tempfile.mkstemp(prefix='.oyasumivr-key-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as file:
            file.write(kept)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
if any(line.split()[:2] == [b'ssh-rsa', key] for line in path.read_bytes().splitlines()):
    raise SystemExit(1)
"#;
    session
        .execute(&["python3", "-B", "-", fields[1]], script)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maintenance_distinguishes_removal_recovery_and_version_ordering() {
        let mut inspection = Inspection {
            installation: "managed".into(),
            service: "running".into(),
            installed_version: Some("0.2.0".into()),
            running_version: Some("0.2.0".into()),
            pairing_id: Some("synthetic-pair".into()),
            device_id: Some("synthetic-device".into()),
            daemon_id: Some("synthetic-daemon".into()),
            transaction_phase: None,
            architecture: "aarch64".into(),
        };
        let bundle = Manifest {
            schema: 1,
            build_version: "0.2.0".into(),
            architecture: "aarch64".into(),
            protocol_major: 1,
            protocol_minor: 1,
            artifact_sha256: String::new(),
            uninstaller_sha256: String::new(),
        };
        assert_eq!(
            policy(&inspection, &bundle, true).unwrap(),
            Maintenance::Use
        );
        inspection.installed_version = Some("0.3.0".into());
        assert_eq!(
            policy(&inspection, &bundle, true).unwrap(),
            Maintenance::Use
        );
        inspection.installed_version = Some("0.1.0".into());
        assert_eq!(
            policy(&inspection, &bundle, true).unwrap(),
            Maintenance::Update
        );
        inspection.transaction_phase = Some("activation".into());
        assert_eq!(
            policy(&inspection, &bundle, true).unwrap(),
            Maintenance::Recover
        );
        inspection.transaction_phase = None;
        inspection.installation = "absent".into();
        inspection.installed_version = None;
        assert_eq!(
            policy(&inspection, &bundle, true).unwrap(),
            Maintenance::RepairNeeded
        );
        assert_eq!(
            policy(&inspection, &bundle, false).unwrap(),
            Maintenance::Update
        );
        inspection.installation = "managed".into();
        assert_eq!(
            verify_owner(
                &inspection,
                "another-pair",
                "synthetic-device",
                "synthetic-daemon"
            ),
            Err(Error::WrongDevice)
        );
    }
}
