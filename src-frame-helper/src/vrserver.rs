use std::time::Duration;

use futures_util::SinkExt;
use serde::Serialize;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue, Message};

/// The headset's SteamVR web server, which Steam UI uses to manage the controllers.
const ADDRESS: &str = "127.0.0.1:27062";
const ORIGIN: &str = "http://127.0.0.1:27062";
const TIMEOUT: Duration = Duration::from_secs(3);
/// Steam UI's controller pairing request header: its length 2, then message type 45.
const REQUEST_HEADER: [u8; 3] = [0x02, 0x08, 0x2D];
/// The request's empty `disconnect_all_controllers` body field 6.
const DISCONNECT_ALL: [u8; 2] = [0x32, 0x00];
/// The longest serial whose message lengths still fit in one byte each.
pub const MAX_SERIAL_LENGTH: usize = 64;

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DisconnectError {
    RuntimeUnavailable,
    WriteFailed,
}

/// Disconnects the controller with this serial, or every connected controller without one. They
/// stay paired and reconnect when woken. An unknown serial does nothing.
pub async fn disconnect_controllers(serial: Option<&str>) -> Result<(), DisconnectError> {
    tokio::time::timeout(TIMEOUT, send_request(request(serial)))
        .await
        .unwrap_or(Err(DisconnectError::RuntimeUnavailable))
}

/// The request packet. A serial, at most [`MAX_SERIAL_LENGTH`] bytes, goes in a
/// `disconnect_controller` body field 5, as its `serial_number` field 1.
fn request(serial: Option<&str>) -> Vec<u8> {
    let mut packet = REQUEST_HEADER.to_vec();
    let Some(serial) = serial else {
        packet.extend(DISCONNECT_ALL);
        return packet;
    };
    let length = serial.len() as u8;
    packet.extend([0x2A, length + 2, 0x0A, length]);
    packet.extend(serial.as_bytes());
    packet
}

async fn send_request(packet: Vec<u8>) -> Result<(), DisconnectError> {
    // open the socket the way SteamVR's own pages do
    let stream = TcpStream::connect(ADDRESS)
        .await
        .map_err(|_| DisconnectError::RuntimeUnavailable)?;
    let mut request = format!("ws://{ADDRESS}")
        .into_client_request()
        .map_err(|_| DisconnectError::RuntimeUnavailable)?;
    // vrserver needs no web secret from its own origin, and refuses a socket without one
    request
        .headers_mut()
        .insert("origin", HeaderValue::from_static(ORIGIN));
    let (mut socket, _) = tokio_tungstenite::client_async(request, stream)
        .await
        .map_err(|_| DisconnectError::RuntimeUnavailable)?;

    // announce a Steam client, then send the request
    let sent = async {
        socket.send(Message::text("steam_connect")).await?;
        socket.send(Message::binary(packet)).await?;
        socket.close(None).await
    };
    sent.await.map_err(|_| DisconnectError::WriteFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_disconnect_requests_steam_ui_sends() {
        assert_eq!(request(None), [0x02, 0x08, 0x2D, 0x32, 0x00]);
        assert_eq!(
            request(Some("96c863a69af3")),
            [
                &[0x02, 0x08, 0x2D, 0x2A, 0x0E, 0x0A, 0x0C][..],
                b"96c863a69af3"
            ]
            .concat()
        );
    }
}
