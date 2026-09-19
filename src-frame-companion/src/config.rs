use serde::{Deserialize, Serialize};
use std::{fs, io, net::IpAddr, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompanionConfig {
    pub bind_address: IpAddr,
    pub port: u16,
    pub device_id: String,
    pub daemon_id: String,
    pub client_token: String,
    pub certificate_path: String,
    pub private_key_path: String,
    #[serde(default)]
    pub openvr_library_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReleaseMetadata {
    pub schema: u8,
    pub build_version: String,
    pub protocol_major: u16,
    pub protocol_minor: u16,
    pub daemon_sha256: String,
}

impl CompanionConfig {
    pub fn read(path: &Path) -> io::Result<Self> {
        let config: Self = serde_json::from_slice(&fs::read(path)?)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        if config.port < 1024
            || config.device_id.is_empty()
            || config.daemon_id.is_empty()
            || config.client_token.len() < 32
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid companion configuration",
            ));
        }
        Ok(config)
    }
}

impl ReleaseMetadata {
    pub fn read(path: &Path) -> io::Result<Self> {
        let metadata: Self = serde_json::from_slice(&fs::read(path)?)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        if metadata.schema != 1 || metadata.build_version.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid release metadata",
            ));
        }
        Ok(metadata)
    }
}
