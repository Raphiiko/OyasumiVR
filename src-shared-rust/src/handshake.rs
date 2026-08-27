use serde::{Deserialize, Serialize};
use std::io::{Error, ErrorKind, Result};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Older than this is refused, so a stale file cannot be replayed.
const MAX_AGE_SECS: u64 = 60;

/// A clock that moved between the write and the read costs this much slack. Beyond it the
/// timestamp is refused, because a future one would otherwise never age out.
const MAX_SKEW_SECS: u64 = 5;

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
    /// Forwarded to the sidecar, which has no way to ask the core before it starts reporting.
    #[serde(default)]
    pub error_reporting_enabled: bool,
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
    pub fn new(
        core_grpc_port: u32,
        core_pid: u32,
        sidecar_path: PathBuf,
        error_reporting_enabled: bool,
    ) -> Self {
        Self {
            written_at: now_secs(),
            core_grpc_port,
            core_pid,
            sidecar_path,
            error_reporting_enabled,
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
        handshake.check_freshness(now_secs())?;
        Ok(handshake)
    }

    fn check_freshness(&self, now: u64) -> Result<()> {
        if self.written_at > now.saturating_add(MAX_SKEW_SECS) {
            return Err(Error::new(
                ErrorKind::InvalidData,
                format!(
                    "handshake is stamped {}s in the future, refusing it",
                    self.written_at.saturating_sub(now)
                ),
            ));
        }
        let age = now.saturating_sub(self.written_at);
        if age > MAX_AGE_SECS {
            return Err(Error::new(
                ErrorKind::InvalidData,
                format!("handshake is {age}s old, refusing it"),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(written_at: u64) -> Handshake {
        Handshake {
            written_at,
            core_grpc_port: 1234,
            core_pid: 42,
            sidecar_path: PathBuf::from(r"C:\x\sidecar.exe"),
            error_reporting_enabled: true,
        }
    }

    #[test]
    fn a_fresh_handshake_is_accepted() {
        let now = 1_000_000;
        assert!(at(now).check_freshness(now).is_ok());
        assert!(at(now - MAX_AGE_SECS).check_freshness(now).is_ok());
    }

    #[test]
    fn an_old_handshake_is_refused() {
        let now = 1_000_000;
        let error = at(now - MAX_AGE_SECS - 1)
            .check_freshness(now)
            .expect_err("must refuse a stale handshake");
        assert!(error.to_string().contains("old"), "{error}");
    }

    #[test]
    fn a_future_handshake_is_refused_rather_than_treated_as_fresh() {
        let now = 1_000_000;
        assert!(
            at(now + MAX_SKEW_SECS).check_freshness(now).is_ok(),
            "a small clock difference is tolerated"
        );
        for ahead in [MAX_SKEW_SECS + 1, 3600, u64::MAX] {
            let error = at(now.saturating_add(ahead))
                .check_freshness(now)
                .expect_err("must refuse a future handshake");
            assert!(error.to_string().contains("future"), "{error}");
        }
    }

    #[test]
    fn a_file_without_the_reporting_flag_still_parses() {
        let raw = br#"{"written_at":1,"core_grpc_port":1,"core_pid":2,"sidecar_path":"C:/x.exe"}"#;
        let handshake: Handshake = serde_json::from_slice(raw).expect("must parse");
        assert!(!handshake.error_reporting_enabled);
    }

    #[test]
    fn a_handshake_round_trips_through_json() {
        let original = at(1_234_567);
        let raw = serde_json::to_vec(&original).unwrap();
        let parsed: Handshake = serde_json::from_slice(&raw).unwrap();
        assert_eq!(parsed.written_at, original.written_at);
        assert_eq!(parsed.core_grpc_port, original.core_grpc_port);
        assert_eq!(parsed.core_pid, original.core_pid);
        assert_eq!(parsed.sidecar_path, original.sidecar_path);
        assert_eq!(
            parsed.error_reporting_enabled,
            original.error_reporting_enabled
        );
    }
}
