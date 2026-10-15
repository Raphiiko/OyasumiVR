use std::time::Duration;

use futures_util::future::join_all;
use serde_json::{json, Value};

use super::{
    connection,
    models::Pairing,
    setup::{self, bundled_digest, BUNDLED_VERSION},
    ssh,
};

/// How long one headset may take to answer, so an unreachable one cannot stall a debug report.
const HEADSET_TIMEOUT: Duration = Duration::from_secs(20);

/// What a debug report carries about the Steam Frame integration, without any secret.
pub struct Diagnostics {
    pub summary: Value,
    /// The helper's diagnostics per pairing id, as `helper.sh diagnostics` prints them.
    pub helper_output: Vec<(String, String)>,
}

pub async fn collect() -> Diagnostics {
    let pairings = connection::pairings().await;
    let states = connection::states().await;

    // ask every paired headset at once
    let outputs = join_all(pairings.iter().map(helper_output)).await;

    let summary = json!({
        "bundledHelper": { "version": BUNDLED_VERSION, "digest": bundled_digest() },
        "pairings": pairings.iter().map(|pairing| json!({
            "id": pairing.id,
            "identity": pairing.identity,
            "address": pairing.access.address,
            "user": pairing.access.user,
            "port": pairing.port,
            "hostKeyPin": pairing.access.host_key_pin,
            "certPin": pairing.cert_pin,
            "state": states.iter().find(|state| state.pairing_id == pairing.id),
        })).collect::<Vec<_>>(),
    });
    let helper_output = pairings
        .iter()
        .zip(outputs)
        .map(|(pairing, output)| (pairing.id.clone(), output))
        .collect();
    Diagnostics {
        summary,
        helper_output,
    }
}

/// The helper's diagnostics, or a line that says why the headset could not give them.
async fn helper_output(pairing: &Pairing) -> String {
    let read = async {
        let session = ssh::connect(&pairing.access)
            .await
            .map_err(|e| format!("could not log in: {e:?}"))?;
        let output = setup::run(&session, &["diagnostics"], b"").await;
        session.close().await;
        let output = output.map_err(|e| format!("could not run the diagnostics: {e:?}"))?;
        let stderr = String::from_utf8_lossy(&output.stderr);
        Ok::<_, String>(format!(
            "exit status: {}\n\n{}{stderr}",
            output.status,
            output.stdout()
        ))
    };
    match tokio::time::timeout(HEADSET_TIMEOUT, read).await {
        Ok(Ok(text)) => text,
        Ok(Err(reason)) => reason,
        Err(_) => format!("no answer within {} s", HEADSET_TIMEOUT.as_secs()),
    }
}
