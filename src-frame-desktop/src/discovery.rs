use crate::{onboarding::validate_address, Error, Result};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const SERVICE: &str = "_steamos-devkit._tcp.local.";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Candidate {
    pub id: Uuid,
    pub address: String,
    pub devkit_port: u16,
    pub ssh_port: u16,
    pub companion_port: u16,
    pub hostname_hint: String,
}

pub fn explicit(address: String) -> Result<Candidate> {
    validate_address(&address)?;
    Ok(Candidate {
        id: Uuid::new_v4(),
        address,
        devkit_port: 32000,
        ssh_port: 22,
        companion_port: 32100,
        hostname_hint: String::new(),
    })
}

pub async fn discover(cancel: CancellationToken) -> Result<Vec<Candidate>> {
    tokio::task::spawn_blocking(move || {
        let daemon = ServiceDaemon::new().map_err(|_| Error::DiscoveryUnavailable)?;
        let result = (|| {
            let receiver = daemon
                .browse(SERVICE)
                .map_err(|_| Error::DiscoveryUnavailable)?;
            let deadline = std::time::Instant::now() + Duration::from_secs(4);
            let mut candidates: Vec<Candidate> = Vec::new();
            while std::time::Instant::now() < deadline {
                if cancel.is_cancelled() {
                    return Err(Error::Cancelled);
                }
                if let Ok(ServiceEvent::ServiceResolved(info)) =
                    receiver.recv_timeout(Duration::from_millis(100))
                {
                    for address in &info.addresses {
                        let address = address.to_string();
                        if validate_address(&address).is_err() || info.port == 0 {
                            continue;
                        }
                        if candidates
                            .iter()
                            .any(|c| c.address == address && c.devkit_port == info.port)
                        {
                            continue;
                        }
                        if candidates.len() == 64 {
                            return Ok(candidates);
                        }
                        candidates.push(Candidate {
                            id: Uuid::new_v4(),
                            address,
                            devkit_port: info.port,
                            ssh_port: 22,
                            companion_port: 32100,
                            hostname_hint: info
                                .host
                                .chars()
                                .filter(|c| !c.is_control())
                                .take(253)
                                .collect(),
                        });
                    }
                }
            }
            Ok(candidates)
        })();
        let _ = daemon.stop_browse(SERVICE);
        if let Ok(stopped) = daemon.shutdown() {
            let _ = stopped.recv_timeout(Duration::from_secs(2));
        }
        result
    })
    .await
    .map_err(|_| Error::DiscoveryUnavailable)?
}
