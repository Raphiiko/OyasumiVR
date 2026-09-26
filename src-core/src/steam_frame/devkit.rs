use std::{sync::LazyLock, time::Duration};

use super::models::RegisterOutcome;
use reqwest::StatusCode;

const PORT: u16 = 32000;

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(5))
        .build()
        .expect("the devkit HTTP client must build")
});

fn url(address: &str, path: &str) -> String {
    let host = if address.contains(':') {
        format!("[{address}]")
    } else {
        address.to_owned()
    };
    format!("http://{host}:{PORT}{path}")
}

/// Returns the account the devkit service installs keys for, which also proves it answers.
pub async fn login_name(address: &str) -> Option<String> {
    let response = CLIENT
        .get(url(address, "/login-name"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let name = response.text().await.ok()?.trim().to_owned();
    (!name.is_empty() && !name.contains(char::is_whitespace)).then_some(name)
}

pub fn classify(status: StatusCode, body: &str) -> RegisterOutcome {
    match status {
        StatusCode::OK if body.trim() == "Registered" => RegisterOutcome::Registered,
        StatusCode::FORBIDDEN if body.contains("timeout") => RegisterOutcome::Timeout,
        StatusCode::FORBIDDEN if body.contains("pairing mode") => RegisterOutcome::NotReady,
        StatusCode::FORBIDDEN if body.contains("Failed to") => RegisterOutcome::Failed,
        StatusCode::FORBIDDEN => RegisterOutcome::Declined,
        _ => RegisterOutcome::Failed,
    }
}

/// Posts this PC's public key. The headset holds the request open while the user decides.
pub async fn register(address: &str, public_key: &str) -> RegisterOutcome {
    let response = CLIENT
        .post(url(address, "/register"))
        .body(public_key.to_owned())
        .timeout(Duration::from_secs(60))
        .send()
        .await;
    let response = match response {
        Ok(response) => response,
        Err(error) if error.is_connect() => return RegisterOutcome::Unreachable,
        Err(_) => return RegisterOutcome::Lost,
    };
    let status = response.status();
    match response.text().await {
        Ok(body) => classify(status, &body),
        Err(_) => RegisterOutcome::Lost,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_devkit_answers() {
        use RegisterOutcome::*;
        let cases = [
            (StatusCode::OK, "Registered\n", Registered),
            (
                StatusCode::FORBIDDEN,
                r#"{"error": "timeout - Steam did not respond to the pairing request"}"#,
                Timeout,
            ),
            (
                StatusCode::FORBIDDEN,
                r#"{"error": "devkit approve-ssh-key: please put the Steam client in pairing mode"}"#,
                NotReady,
            ),
            (StatusCode::FORBIDDEN, r#"{"error": "denied"}"#, Declined),
            (
                StatusCode::FORBIDDEN,
                r#"{"error":"Failed to write the ssh key"}"#,
                Failed,
            ),
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "install-ssh-key:\n",
                Failed,
            ),
        ];
        for (status, body, expected) in cases {
            assert_eq!(classify(status, body), expected, "{body}");
        }
    }

    #[test]
    fn brackets_ipv6_hosts() {
        assert_eq!(url("192.168.1.2", "/x"), "http://192.168.1.2:32000/x");
        assert_eq!(url("fe80::1", "/x"), "http://[fe80::1]:32000/x");
    }
}
