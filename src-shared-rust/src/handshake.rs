use serde::{Deserialize, Serialize};
use std::io::{Error, ErrorKind, Result};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Older than this is refused, so a stale file cannot be replayed.
const MAX_AGE_SECS: u64 = 60;

/// Written by the core right before it starts the launcher and the sidecar.
///
/// The user can write this file, so nothing in it is trusted. `sidecar_path` only names a
/// candidate, whose signature the launcher verifies before running it.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Handshake {
    pub written_at: u64,
    pub core_grpc_port: u32,
    pub core_pid: u32,
    pub sidecar_path: PathBuf,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn dir() -> Result<PathBuf> {
    let local = std::env::var("LOCALAPPDATA")
        .map_err(|_| Error::new(ErrorKind::NotFound, "LOCALAPPDATA is not set"))?;
    Ok(PathBuf::from(local).join("co.raphii.oyasumi"))
}

pub fn path() -> Result<PathBuf> {
    Ok(dir()?.join("elevated-sidecar-handshake.json"))
}

impl Handshake {
    pub fn new(core_grpc_port: u32, core_pid: u32, sidecar_path: PathBuf) -> Self {
        Self {
            written_at: now_secs(),
            core_grpc_port,
            core_pid,
            sidecar_path,
        }
    }

    /// Writes to a temporary file and renames, so a reader never sees partial JSON.
    pub fn write(&self) -> Result<()> {
        let path = path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(self).map_err(Error::other)?)?;
        std::fs::rename(&tmp, &path)
    }

    pub fn read() -> Result<Self> {
        let raw = std::fs::read(path()?)?;
        let handshake: Self = serde_json::from_slice(&raw).map_err(Error::other)?;
        let age = now_secs().saturating_sub(handshake.written_at);
        if age > MAX_AGE_SECS {
            return Err(Error::new(
                ErrorKind::InvalidData,
                format!("handshake is {age}s old, refusing it"),
            ));
        }
        Ok(handshake)
    }
}
