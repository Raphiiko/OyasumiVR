use crate::{
    ssh::Session,
    storage::{Record, Store},
    Error, Result,
};
use russh::keys::{ssh_key::private::RsaKeypair, PrivateKey};
use std::{net::IpAddr, time::Duration};
use tokio::{sync::Mutex, time::sleep};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub struct Onboarding {
    pub store: Store,
    operation: Mutex<()>,
    cancellation: std::sync::Mutex<Option<(Uuid, CancellationToken)>>,
}

impl Onboarding {
    pub fn new(store: Store) -> Self {
        Self {
            store,
            operation: Mutex::new(()),
            cancellation: std::sync::Mutex::new(None),
        }
    }

    pub async fn create(
        &self,
        selected_device: String,
        address: String,
        devkit_port: u16,
        ssh_port: u16,
        pc_name: String,
    ) -> Result<Record> {
        let _guard = self.operation.try_lock().map_err(|_| Error::Busy)?;
        validate_address(&address)?;
        if selected_device.is_empty()
            || selected_device.len() > 256
            || selected_device.chars().any(char::is_control)
            || ssh_port == 0
            || devkit_port == 0
        {
            return Err(Error::InvalidInput);
        }
        let comment = pc_comment(&pc_name);
        let key = tokio::task::spawn_blocking(move || {
            let rsa = RsaKeypair::random(&mut rand::rng(), 3072).map_err(|_| Error::Persistence)?;
            let mut key = PrivateKey::from(rsa);
            key.set_comment(comment);
            Ok::<_, Error>(key)
        })
        .await
        .map_err(|_| Error::Persistence)??;
        let id = Uuid::new_v4();
        let record = Record {
            id,
            device_manager_id: selected_device,
            address,
            ssh_port,
            devkit_port,
            companion_port: 32100,
            credential_ref: id,
            public_key: key
                .public_key()
                .to_openssh()
                .map_err(|_| Error::Persistence)?,
            ssh_host_key: None,
            registration_attempted: false,
            ssh_verified: false,
            verified_device_id: None,
            completed: false,
            selected_identity: None,
            companion: None,
            pending_upload: None,
            last_contact: None,
            maintenance_after: 0,
            maintenance_error: None,
            repair_needed: false,
            remote_cleanup_confirmed: false,
            installed_version: None,
            paired_at: None,
            setup_stage: 0,
        };
        self.store.put_secret(
            id,
            key.to_openssh(russh::keys::ssh_key::LineEnding::LF)
                .map_err(|_| Error::Persistence)?
                .as_bytes(),
        )?;
        self.store.save(&record)?;
        Ok(record)
    }

    pub fn cancel(&self, id: Uuid) -> Result<()> {
        if let Some((active, token)) = self.cancellation.lock().map_err(|_| Error::Busy)?.as_ref() {
            if *active == id {
                token.cancel();
                return Ok(());
            }
        }
        Err(Error::InvalidInput)
    }

    pub async fn access(&self, id: Uuid, user: &str, approval_requested: bool) -> Result<Session> {
        self.access_cancellable(id, user, approval_requested, CancellationToken::new())
            .await
    }

    pub async fn access_cancellable(
        &self,
        id: Uuid,
        user: &str,
        approval_requested: bool,
        token: CancellationToken,
    ) -> Result<Session> {
        self.access_observe(id, user, approval_requested, token, || {})
            .await
    }

    pub async fn access_observe(
        &self,
        id: Uuid,
        user: &str,
        approval_requested: bool,
        token: CancellationToken,
        progress: impl Fn() + Send + Sync,
    ) -> Result<Session> {
        let _guard = self.operation.try_lock().map_err(|_| Error::Busy)?;
        *self.cancellation.lock().map_err(|_| Error::Busy)? = Some((id, token.clone()));
        let result = self
            .access_inner(id, user, approval_requested, &token, &progress)
            .await;
        *self.cancellation.lock().map_err(|_| Error::Busy)? = None;
        result
    }

    async fn access_inner(
        &self,
        id: Uuid,
        user: &str,
        approval_requested: bool,
        token: &CancellationToken,
        progress: &(dyn Fn() + Send + Sync),
    ) -> Result<Session> {
        if user.is_empty()
            || user.len() > 64
            || !user
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err(Error::InvalidInput);
        }
        let mut record = self.store.load(id)?;
        validate_address(&record.address)?;
        let secret = self.store.secret(record.credential_ref)?;
        let private =
            PrivateKey::from_openssh(secret.as_slice()).map_err(|_| Error::Persistence)?;
        if private
            .public_key()
            .to_openssh()
            .map_err(|_| Error::Persistence)?
            != record.public_key
        {
            return Err(Error::Persistence);
        }
        let connect = || {
            Session::connect(
                &record.address,
                record.ssh_port,
                user,
                &secret,
                record.ssh_host_key.as_deref(),
            )
        };
        let first = tokio::select! {
            _ = token.cancelled() => return Err(Error::Cancelled),
            result = connect() => result,
        };
        match first {
            Ok(session) => return self.save_access(record, session),
            Err(Error::HostKeyChanged) => return Err(Error::HostKeyChanged),
            Err(error) if !approval_requested => return Err(error),
            Err(_) => {}
        }
        if token.is_cancelled() {
            return Err(Error::Cancelled);
        }
        record.registration_attempted = true;
        self.store.save(&record)?;
        progress();
        let registration = register(
            &record.address,
            record.devkit_port,
            &record.public_key,
            token,
        )
        .await;
        if matches!(
            registration,
            Err(Error::NotArmed
                | Error::Denied
                | Error::Timeout
                | Error::Busy
                | Error::Cancelled
                | Error::InvalidInput)
        ) {
            return Err(registration.unwrap_err());
        }
        for delay in [1000, 2000, 4000, 8000, 16000, 30000] {
            tokio::select! {
                _ = token.cancelled() => return Err(Error::Cancelled),
                _ = sleep(Duration::from_millis(delay)) => {}
            }
            let result = tokio::select! {
                _ = token.cancelled() => return Err(Error::Cancelled),
                result = Session::connect(&record.address, record.ssh_port, user, &secret, record.ssh_host_key.as_deref()) => result,
            };
            match result {
                Ok(session) => return self.save_access(record, session),
                Err(Error::HostKeyChanged) => return Err(Error::HostKeyChanged),
                Err(_) => {}
            }
        }
        Err(registration.err().unwrap_or(Error::AuthenticationFailed))
    }

    fn save_access(&self, mut record: Record, session: Session) -> Result<Session> {
        record.ssh_host_key = Some(session.host_key.clone());
        record.ssh_verified = true;
        self.store.save(&record)?;
        Ok(session)
    }
}

pub fn validate_address(address: &str) -> Result<()> {
    if address.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    if address.is_empty()
        || address.len() > 253
        || !address.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
    {
        return Err(Error::InvalidInput);
    }
    Ok(())
}

fn pc_comment(name: &str) -> String {
    let clean: String = name
        .chars()
        .take(63)
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("OyasumiVR@{}", if clean.is_empty() { "PC" } else { &clean })
}

pub async fn register(
    address: &str,
    port: u16,
    public_key: &str,
    cancel: &CancellationToken,
) -> Result<()> {
    validate_address(address)?;
    let fields: Vec<_> = public_key.split(' ').collect();
    if port == 0
        || fields.len() != 3
        || fields[0] != "ssh-rsa"
        || fields[2].is_empty()
        || public_key.chars().any(char::is_control)
        || public_key.len() > 8192
        || russh::keys::PublicKey::from_openssh(public_key).is_err()
    {
        return Err(Error::InvalidInput);
    }
    let host = if address.contains(':') {
        format!("[{address}]")
    } else {
        address.to_owned()
    };
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(65))
        .build()
        .map_err(|_| Error::Offline)?;
    let request = async {
        let mut response = client
            .post(format!("http://{host}:{port}/register"))
            .body(public_key.to_owned())
            .send()
            .await
            .map_err(|_| Error::RegistrationUncertain)?;
        let status = response.status();
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| Error::RegistrationUncertain)?
        {
            if body.len() + chunk.len() > 8192 {
                return Err(Error::RegistrationUncertain);
            }
            body.extend_from_slice(&chunk);
        }
        if status == 200 && body == b"Registered\n" {
            return Ok(());
        }
        if status == 409 {
            return Err(Error::Busy);
        }
        if status != 403 {
            return Err(Error::RegistrationUncertain);
        }
        let body: serde_json::Value =
            serde_json::from_slice(&body).map_err(|_| Error::RegistrationUncertain)?;
        let error = body["error"].as_str().ok_or(Error::RegistrationUncertain)?;
        if error.contains("pairing mode") {
            Err(Error::NotArmed)
        } else if error.contains("denied") {
            Err(Error::Denied)
        } else if error.contains("timeout") {
            Err(Error::Timeout)
        } else {
            Err(Error::RegistrationUncertain)
        }
    };
    tokio::select! { _ = cancel.cancelled() => Err(Error::Cancelled), result = request => result }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_inputs_and_sanitizes_comment() {
        for bad in [
            "a/b",
            "host:22",
            "user@host",
            "-oProxyCommand=x",
            "a\nb",
            "",
        ] {
            assert_eq!(validate_address(bad), Err(Error::InvalidInput));
        }
        for good in ["steam-frame", "127.0.0.1", "::1"] {
            validate_address(good).unwrap();
        }
        assert_eq!(pc_comment("My PC\n$(x)"), "OyasumiVR@My_PC___x_");
    }
}
