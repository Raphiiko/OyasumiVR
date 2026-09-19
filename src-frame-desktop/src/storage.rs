use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;
use zeroize::Zeroizing;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Record {
    pub id: Uuid,
    pub device_manager_id: String,
    pub address: String,
    pub ssh_port: u16,
    pub devkit_port: u16,
    #[serde(default = "default_port")]
    pub companion_port: u16,
    pub credential_ref: Uuid,
    pub public_key: String,
    pub ssh_host_key: Option<String>,
    pub registration_attempted: bool,
    pub ssh_verified: bool,
    pub verified_device_id: Option<String>,
    pub completed: bool,
    #[serde(default)]
    pub selected_identity: Option<crate::identity::Identity>,
    #[serde(default)]
    pub companion: Option<Companion>,
    #[serde(default)]
    pub pending_upload: Option<Uuid>,
    #[serde(default)]
    pub last_contact: Option<u64>,
    #[serde(default)]
    pub maintenance_after: u64,
    #[serde(default)]
    pub maintenance_error: Option<Error>,
    #[serde(default)]
    pub repair_needed: bool,
    #[serde(default)]
    pub remote_cleanup_confirmed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Companion {
    pub credential_ref: Uuid,
    pub daemon_id: String,
    pub certificate_sha256: String,
    pub root: String,
    pub unit: String,
    pub home: String,
    pub port: u16,
}

pub struct Store {
    root: PathBuf,
}

fn default_port() -> u16 {
    32100
}

impl Store {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(|_| Error::Persistence)?;
        Ok(Self { root })
    }

    pub fn records(&self) -> Result<Vec<Record>> {
        let mut records = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|_| Error::Persistence)? {
            let entry = entry.map_err(|_| Error::Persistence)?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| Uuid::parse_str(s).ok())
                .ok_or(Error::Persistence)?;
            records.push(self.load(id)?);
        }
        Ok(records)
    }

    pub fn forget(&self, id: Uuid) -> Result<()> {
        let record = self.load(id)?;
        for reference in [
            Some(record.credential_ref),
            record.companion.as_ref().map(|c| c.credential_ref),
        ]
        .into_iter()
        .flatten()
        {
            let path = self.root.join(format!("{reference}.dpapi"));
            if let Err(error) = fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(Error::Persistence);
                }
            }
        }
        fs::remove_file(self.root.join(format!("{id}.json"))).map_err(|_| Error::Persistence)
    }

    pub fn save(&self, record: &Record) -> Result<()> {
        atomic_write(
            &self.root.join(format!("{}.json", record.id)),
            &serde_json::to_vec(record).map_err(|_| Error::Persistence)?,
        )
    }

    pub fn load(&self, id: Uuid) -> Result<Record> {
        let bytes =
            fs::read(self.root.join(format!("{id}.json"))).map_err(|_| Error::Persistence)?;
        let record: Record = serde_json::from_slice(&bytes).map_err(|_| Error::Persistence)?;
        if record.id != id {
            return Err(Error::Persistence);
        }
        Ok(record)
    }

    pub fn put_secret(&self, id: Uuid, secret: &[u8]) -> Result<()> {
        let protected = protect(secret)?;
        atomic_write(&self.root.join(format!("{id}.dpapi")), &protected)
    }

    pub fn secret(&self, id: Uuid) -> Result<Zeroizing<Vec<u8>>> {
        let bytes =
            fs::read(self.root.join(format!("{id}.dpapi"))).map_err(|_| Error::Persistence)?;
        unprotect(&bytes).map(Zeroizing::new)
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or(Error::Persistence)?)
        .map_err(|_| Error::Persistence)?;
    temporary.write_all(bytes).map_err(|_| Error::Persistence)?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| Error::Persistence)?;
    temporary.persist(path).map_err(|_| Error::Persistence)?;
    Ok(())
}

#[cfg(windows)]
mod dpapi {
    use super::*;
    use windows::Win32::{
        Foundation::HLOCAL,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    use windows_core::{Owned, PCWSTR};

    pub fn transform(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(bytes.len()).map_err(|_| Error::Persistence)?,
            pbData: bytes.as_ptr().cast_mut(),
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            if encrypt {
                CryptProtectData(
                    &input,
                    PCWSTR::null(),
                    None,
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            } else {
                CryptUnprotectData(
                    &input,
                    None,
                    None,
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            }
        }
        .map_err(|_| Error::Persistence)?;
        let allocation = unsafe { Owned::new(HLOCAL(output.pbData.cast())) };
        let result = if output.cbData == 0 {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec()
        };
        drop(allocation);
        Ok(result)
    }
}

pub fn protect(bytes: &[u8]) -> Result<Vec<u8>> {
    #[cfg(windows)]
    {
        dpapi::transform(bytes, true)
    }
    #[cfg(not(windows))]
    {
        let _ = bytes;
        Err(Error::UnsupportedPlatform)
    }
}
pub fn unprotect(bytes: &[u8]) -> Result<Vec<u8>> {
    #[cfg(windows)]
    {
        dpapi::transform(bytes, false)
    }
    #[cfg(not(windows))]
    {
        let _ = bytes;
        Err(Error::UnsupportedPlatform)
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn protected_storage_survives_restart_and_rejects_corruption() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path().to_owned()).unwrap();
        let id = Uuid::new_v4();
        let secret = b"DISPOSABLE-STORAGE-TEST";
        store.put_secret(id, secret).unwrap();
        let path = directory.path().join(format!("{id}.dpapi"));
        assert!(!fs::read(&path)
            .unwrap()
            .windows(secret.len())
            .any(|w| w == secret));
        drop(store);
        let store = Store::open(directory.path().to_owned()).unwrap();
        assert_eq!(&**store.secret(id).unwrap(), secret);
        fs::write(path, b"partial").unwrap();
        assert!(matches!(store.secret(id), Err(Error::Persistence)));
    }

    #[test]
    fn failed_atomic_replace_preserves_previous_file() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("metadata.json");
        atomic_write(&path, b"previous").unwrap();
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(atomic_write(&path, b"partial").is_err());
        drop(held);
        assert_eq!(fs::read(&path).unwrap(), b"previous");
        atomic_write(&path, b"next").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"next");
        assert!(atomic_write(&directory.path().join("absent/metadata"), b"partial").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"next");
    }
}
