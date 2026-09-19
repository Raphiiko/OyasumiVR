use crate::{Error, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    pub serial: String,
    pub model: String,
    pub manufacturer: String,
}

pub fn reconcile(selected: &Identity, remote: &Identity) -> Result<String> {
    for value in [
        &selected.serial,
        &selected.model,
        &selected.manufacturer,
        &remote.serial,
        &remote.model,
        &remote.manufacturer,
    ] {
        if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
            return Err(Error::IdentityUnverified);
        }
    }
    if selected.manufacturer != "Valve"
        || remote.manufacturer != "Valve"
        || selected.model != remote.model
    {
        return Err(Error::WrongDevice);
    }
    if selected.model != "Deckard DV2" || selected.serial != remote.serial {
        return Err(Error::IdentityUnverified);
    }
    Ok(remote.serial.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_exact_identity_without_serial_normalization() {
        let selected = Identity {
            serial: "SYNTHETIC-001".into(),
            model: "Deckard DV2".into(),
            manufacturer: "Valve".into(),
        };
        assert_eq!(reconcile(&selected, &selected).unwrap(), "SYNTHETIC-001");
        let mut remote = selected.clone();
        remote.serial = "cv.SYNTHETIC-001".into();
        assert_eq!(
            reconcile(&selected, &remote),
            Err(Error::IdentityUnverified)
        );
        remote.model = "Steam Deck".into();
        assert_eq!(reconcile(&selected, &remote), Err(Error::WrongDevice));
    }
}
