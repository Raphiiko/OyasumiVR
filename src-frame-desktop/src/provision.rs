use crate::{
    lifecycle::{self, Bundle},
    ssh::Session,
    Error, Result,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct Provision {
    pub token: String,
    pub server_pem: String,
    pub server_der: Vec<u8>,
    pub private_key_pem: String,
    pub daemon_id: String,
}

impl Provision {
    pub fn generate() -> Result<Self> {
        let rcgen::CertifiedKey { cert, key_pair } =
            rcgen::generate_simple_self_signed(vec!["oyasumivr-frame-companion".into()])
                .map_err(|_| Error::Persistence)?;
        Ok(Self {
            token: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
            server_pem: cert.pem(),
            server_der: cert.der().to_vec(),
            private_key_pem: key_pair.serialize_pem(),
            daemon_id: Uuid::new_v4().to_string(),
        })
    }
}

pub struct Installation<'a> {
    pub root: &'a str,
    pub unit: &'a str,
    pub pairing: &'a str,
    pub device: &'a str,
    pub home: &'a str,
    pub public_key: &'a str,
    pub port: u16,
    pub openvr_library: Option<&'a str>,
}

pub async fn create_session(session: &Session, home: &str, id: Uuid) -> Result<String> {
    validate_home(home)?;
    let path = format!("{home}/.oyasumivr-frame-session-{id}");
    session
        .execute(
            &[
                "bash",
                "-c",
                "umask 077; mkdir -- \"$1\" && printf '%s' \"$2\" > \"$1/owner\"",
                "session",
                &path,
                &id.to_string(),
            ],
            &[],
        )
        .await?;
    Ok(path)
}

pub async fn cleanup_session(session: &Session, home: &str, id: Uuid) -> Result<()> {
    validate_home(home)?;
    let path = format!("{home}/.oyasumivr-frame-session-{id}");
    let script = br#"import os, pathlib, sys
root = pathlib.Path(sys.argv[1])
if not root.exists():
    raise SystemExit(0)
if root.is_symlink() or root.resolve() != root:
    raise SystemExit(1)
if not any(root.iterdir()):
    root.rmdir()
    raise SystemExit(0)
if (root / 'owner').is_symlink() or (root / 'owner').read_text() != sys.argv[2]:
    raise SystemExit(1)
for name in ['artifact', 'uninstall', 'owner.json', 'config.json', 'server.pem', 'server-key.pem']:
    path = root / name
    if path.is_symlink() or path.is_dir():
        raise SystemExit(1)
    path.unlink(missing_ok=True)
if set(p.name for p in root.iterdir()) != {'owner'}:
    raise SystemExit(1)
(root / 'owner').unlink()
root.rmdir()
"#;
    session
        .execute(&["python3", "-B", "-", &path, &id.to_string()], script)
        .await?;
    Ok(())
}

fn validate_home(home: &str) -> Result<()> {
    if !home.starts_with("/home/")
        || home.len() > 256
        || home.contains("..")
        || !home
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"/_-.".contains(&c))
    {
        return Err(Error::InvalidInput);
    }
    Ok(())
}

pub async fn apply(
    session: &Session,
    bundle: &Bundle,
    target: &Installation<'_>,
    provision: &Provision,
    upload_dir: &str,
) -> Result<()> {
    let fields: Vec<_> = target.public_key.split_whitespace().collect();
    if fields.len() != 3 || fields[0] != "ssh-rsa" || target.port < 1024 {
        return Err(Error::InvalidInput);
    }
    let owner = serde_json::json!({"schema": 1, "pairing_id": target.pairing, "device_id": target.device,
        "unit_name": target.unit, "owned_ssh_key": {"authorized_keys_path": format!("{}/.ssh/authorized_keys", target.home),
            "key_type": fields[0], "key_data": fields[1]}});
    let config = serde_json::json!({"bind_address": "0.0.0.0", "port": target.port,
        "device_id": target.device, "daemon_id": provision.daemon_id, "client_token": provision.token,
        "certificate_path": format!("{}/state/server.pem", target.root),
        "private_key_path": format!("{}/state/server-key.pem", target.root), "openvr_library_path": target.openvr_library});
    let config_bytes =
        zeroize::Zeroizing::new(serde_json::to_vec(&config).map_err(|_| Error::Persistence)?);
    for (name, bytes) in [
        ("artifact", bundle.artifact.as_slice()),
        ("uninstall", lifecycle::UNINSTALLER),
        (
            "owner.json",
            serde_json::to_vec(&owner)
                .map_err(|_| Error::Persistence)?
                .as_slice(),
        ),
        ("config.json", config_bytes.as_slice()),
        ("server.pem", provision.server_pem.as_bytes()),
        ("server-key.pem", provision.private_key_pem.as_bytes()),
    ] {
        lifecycle::upload(session, &format!("{upload_dir}/{name}"), bytes).await?;
    }
    let manifest = &bundle.manifest;
    let artifact = format!("{upload_dir}/artifact");
    let hash = session.execute(&["sha256sum", &artifact], &[]).await?;
    if hash.split(|b| b.is_ascii_whitespace()).next() != Some(manifest.artifact_sha256.as_bytes()) {
        return Err(Error::ArtifactUnavailable);
    }
    session.execute(&["chmod", "700", &artifact], &[]).await?;
    let probe = session
        .execute(
            &[
                &artifact,
                "probe-identity",
                "/nonexistent/oyasumivr-openvr-probe",
            ],
            &[],
        )
        .await?;
    let probe: serde_json::Value =
        serde_json::from_slice(&probe).map_err(|_| Error::ArtifactUnavailable)?;
    if probe["build_version"] != manifest.build_version {
        return Err(Error::ArtifactUnavailable);
    }
    let result = lifecycle::invoke(
        session,
        &[
            "apply",
            target.root,
            target.unit,
            &format!("{upload_dir}/artifact"),
            &manifest.artifact_sha256,
            &manifest.build_version,
            &manifest.architecture,
            target.pairing,
            target.device,
            upload_dir,
            &format!("{upload_dir}/uninstall"),
            &manifest.uninstaller_sha256,
            &target.port.to_string(),
            "16777216",
            "false",
        ],
    )
    .await?;
    if result["installed_version"] != manifest.build_version
        || result["protocol"]["major"] != 1
        || result["protocol"]["minor"] != 1
        || !matches!(
            result["action"].as_str(),
            Some("installed" | "updated" | "reused" | "repaired")
        )
    {
        return Err(Error::RemoteOperation);
    }
    Ok(())
}
