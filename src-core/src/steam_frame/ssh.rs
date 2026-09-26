use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use russh::{
    client::{self, Handle},
    keys::{
        ssh_key::{private::KeypairData, private::RsaKeypair, LineEnding},
        HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate,
    },
    ChannelMsg,
};

use super::models::Access;

#[derive(Debug, PartialEq)]
pub enum SshError {
    Unreachable,
    /// The headset answered with a host key other than the pinned one.
    HostKeyChanged,
    /// The headset did not accept this PC's key.
    Rejected,
    Failed(String),
}

pub struct Credentials {
    pub private_key: String,
    pub public_key: String,
}

/// Creates the RSA key this PC registers with the devkit service, which accepts nothing else.
/// The public key is `ssh-rsa <base64> <comment>`, and the headset shows the comment to the user.
pub fn create_credentials(comment: &str) -> Result<Credentials, String> {
    // keep the comment to printable ASCII
    let comment: String = comment
        .chars()
        .map(|c| if c.is_ascii_graphic() { c } else { '-' })
        .collect();
    // generate the key pair
    let keypair = RsaKeypair::random(&mut rand::rng(), 3072).map_err(|e| e.to_string())?;
    let key =
        PrivateKey::new(KeypairData::from(keypair), comment.clone()).map_err(|e| e.to_string())?;
    // encode both halves in OpenSSH format
    let mut public_key = key.public_key().clone();
    public_key.set_comment("");
    let public_key = format!(
        "{} {comment}",
        public_key.to_openssh().map_err(|e| e.to_string())?.trim()
    );
    let private_key = key.to_openssh(LineEnding::LF).map_err(|e| e.to_string())?;
    Ok(Credentials {
        private_key: private_key.to_string(),
        public_key,
    })
}

/// Checks the headset's host key against the pin, and records the key it saw.
struct Client {
    expected: Option<String>,
    observed: Arc<Mutex<Option<String>>>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let PublicKeyOrCertificate::PublicKey { key, .. } = key else {
            return Ok(false);
        };
        let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
        let trusted = self.expected.as_ref().is_none_or(|pin| *pin == fingerprint);
        *self.observed.lock().unwrap() = Some(fingerprint);
        Ok(trusted)
    }
}

pub struct Session {
    handle: Handle<Client>,
    pub host_key_pin: String,
}

pub struct Output {
    pub status: u32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl Output {
    /// Standard output as text, with invalid UTF-8 replaced.
    pub fn stdout(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

/// Logs in with this PC's key. The session trusts only the pinned host key, when there is one.
pub async fn connect(access: &Access) -> Result<Session, SshError> {
    // prepare the key and the host key check
    let key = russh::keys::decode_secret_key(&access.private_key, None)
        .map_err(|e| SshError::Failed(format!("invalid private key: {e}")))?;
    let observed = Arc::new(Mutex::new(None));
    let handler = Client {
        expected: access.host_key_pin.clone(),
        observed: observed.clone(),
    };
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(60)),
        ..Default::default()
    });
    // connect; a wrong host key gets its own error
    let address = (access.address.as_str(), 22);
    let mut handle = match tokio::time::timeout(
        Duration::from_secs(10),
        client::connect(config, address, handler),
    )
    .await
    {
        Err(_) => return Err(SshError::Unreachable),
        Ok(Err(russh::Error::UnknownKey)) => return Err(SshError::HostKeyChanged),
        Ok(Err(russh::Error::IO(_) | russh::Error::Disconnect)) => {
            return Err(SshError::Unreachable)
        }
        Ok(Err(error)) => return Err(SshError::Failed(error.to_string())),
        Ok(Ok(handle)) => handle,
    };
    // record the host key for a first-login pin
    let host_key_pin = observed
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| SshError::Failed("no host key".into()))?;
    // log in with the strongest accepted RSA signature
    let hash = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|e| SshError::Failed(e.to_string()))?
        .flatten();
    let result = handle
        .authenticate_publickey(
            access.user.clone(),
            PrivateKeyWithHashAlg::new(Arc::new(key), hash),
        )
        .await
        .map_err(|e| SshError::Failed(e.to_string()))?;
    if !result.success() {
        return Err(SshError::Rejected);
    }
    Ok(Session {
        handle,
        host_key_pin,
    })
}

impl Session {
    /// Runs one command to completion, feeding it `stdin` and then end of file.
    pub async fn exec(&self, command: &str, stdin: &[u8]) -> Result<Output, SshError> {
        let failed = |e: russh::Error| SshError::Failed(e.to_string());
        // start the command and send all of stdin
        let mut channel = self.handle.channel_open_session().await.map_err(failed)?;
        channel.exec(true, command).await.map_err(failed)?;
        channel.data(stdin).await.map_err(failed)?;
        channel.eof().await.map_err(failed)?;
        // collect output until the channel closes
        let mut output = Output {
            status: u32::MAX,
            stdout: Vec::new(),
            stderr: Vec::new(),
        };
        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => output.stdout.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, .. } => output.stderr.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status } => output.status = exit_status,
                _ => {}
            }
        }
        Ok(output)
    }

    pub async fn close(self) {
        let _ = self
            .handle
            .disconnect(russh::Disconnect::ByApplication, "", "en")
            .await;
    }
}
