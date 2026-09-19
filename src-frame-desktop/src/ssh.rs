use crate::{Error, Result};
use russh::{
    client,
    keys::PublicKeyOrCertificate,
    keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg},
    ChannelMsg,
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::time::timeout;

struct Verifier {
    expected: Option<String>,
    observed: Arc<Mutex<Option<String>>>,
}
impl client::Handler for Verifier {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> std::result::Result<bool, Self::Error> {
        if key.certificate().is_some() {
            return Ok(false);
        }
        let pin = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        *self.observed.lock().unwrap() = Some(pin.clone());
        Ok(self
            .expected
            .as_ref()
            .is_none_or(|expected| *expected == pin))
    }
}

pub struct Session {
    handle: client::Handle<Verifier>,
    pub host_key: String,
}

impl Session {
    /// An absent pin uses first-use local-network trust, never HTTP identity proof.
    pub async fn connect(
        address: &str,
        port: u16,
        user: &str,
        private_key: &[u8],
        pin: Option<&str>,
    ) -> Result<Self> {
        let observed = Arc::new(Mutex::new(None));
        let verifier = Verifier {
            expected: pin.map(str::to_owned),
            observed: observed.clone(),
        };
        let config = client::Config {
            inactivity_timeout: Some(Duration::from_secs(120)),
            ..Default::default()
        };
        let result = timeout(
            Duration::from_secs(8),
            client::connect(Arc::new(config), (address, port), verifier),
        )
        .await;
        let host_key = observed.lock().unwrap().clone();
        if pin.is_some()
            && host_key
                .as_deref()
                .is_some_and(|actual| Some(actual) != pin)
        {
            return Err(Error::HostKeyChanged);
        }
        let mut handle = result
            .map_err(|_| Error::Offline)?
            .map_err(|_| Error::Offline)?;
        let key = PrivateKey::from_openssh(private_key).map_err(|_| Error::Persistence)?;
        let hash = timeout(Duration::from_secs(8), handle.best_supported_rsa_hash())
            .await
            .map_err(|_| Error::Timeout)?
            .map_err(|_| Error::AuthenticationFailed)?
            .flatten();
        if hash.is_none() {
            return Err(Error::AuthenticationFailed);
        }
        let authenticated = timeout(
            Duration::from_secs(8),
            handle.authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash)),
        )
        .await
        .map_err(|_| Error::Timeout)?
        .map_err(|_| Error::AuthenticationFailed)?;
        if !authenticated.success() {
            return Err(Error::AuthenticationFailed);
        }
        Ok(Self {
            handle,
            host_key: host_key.ok_or(Error::Offline)?,
        })
    }

    pub async fn execute(&self, args: &[&str], input: &[u8]) -> Result<Vec<u8>> {
        let command = args
            .iter()
            .map(|arg| quote(arg))
            .collect::<Result<Vec<_>>>()?
            .join(" ");
        timeout(Duration::from_secs(120), async {
            let mut channel = self
                .handle
                .channel_open_session()
                .await
                .map_err(|_| Error::Offline)?;
            channel
                .exec(true, command)
                .await
                .map_err(|_| Error::RemoteOperation)?;
            channel.data(input).await.map_err(|_| Error::Offline)?;
            channel.eof().await.map_err(|_| Error::Offline)?;
            let mut output = Vec::new();
            let mut count = 0;
            let mut status = None;
            while let Some(message) = channel.wait().await {
                match message {
                    ChannelMsg::Data { data } => {
                        count += data.len();
                        output.extend_from_slice(&data);
                    }
                    ChannelMsg::ExtendedData { data, .. } => {
                        count += data.len();
                    }
                    ChannelMsg::ExitStatus { exit_status } => status = Some(exit_status),
                    _ => {}
                }
                if count > 65536 {
                    let _ = channel.close().await;
                    return Err(Error::RemoteOperation);
                }
            }
            if status != Some(0) {
                return Err(Error::RemoteOperation);
            }
            Ok(output)
        })
        .await
        .map_err(|_| Error::Timeout)?
    }

    pub async fn close(self) {
        let _ = self
            .handle
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await;
    }
}

pub fn quote(value: &str) -> Result<String> {
    if value.contains('\0') || value.len() > 8192 {
        return Err(Error::InvalidInput);
    }
    Ok(format!("'{}'", value.replace('\'', "'\\''")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quotes_shell_metacharacters_as_data() {
        assert_eq!(quote("a'b;$(echo nope)").unwrap(), "'a'\\''b;$(echo nope)'");
        assert_eq!(quote("bad\0value"), Err(Error::InvalidInput));
    }
}
