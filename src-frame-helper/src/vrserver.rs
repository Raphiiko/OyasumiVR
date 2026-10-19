use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
    WebSocketStream,
};

use crate::hub::Hub;

/// The headset's SteamVR web server, which Steam UI uses to manage the controllers.
const ADDRESS: &str = "127.0.0.1:27062";
const ORIGIN: &str = "http://127.0.0.1:27062";
const TIMEOUT: Duration = Duration::from_secs(3);
/// Steam UI's controller pairing request header: its length 2, then message type 45.
const REQUEST_HEADER: [u8; 3] = [0x02, 0x08, 0x2D];
/// The pairing request with an empty `update` field 1, which vrserver answers with its state.
const STATE_REQUEST: [u8; 5] = [0x02, 0x08, 0x2D, 0x0A, 0x00];
/// The message type of vrserver's controller pairing state.
const STATE_MESSAGE: u64 = 44;
// ponytail: polls, as nobody has seen vrserver push a state change; drop the poll if it does
const POLL_INTERVAL: Duration = Duration::from_secs(1);
/// A socket that sends no state for this long counts as failed.
const STATE_TIMEOUT: Duration = Duration::from_secs(5);
/// The longest serial the helper accepts, below the 126 bytes at which a length needs two bytes.
pub const MAX_SERIAL_LENGTH: usize = 64;

type Socket = WebSocketStream<TcpStream>;

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DisconnectError {
    RuntimeUnavailable,
    WriteFailed,
}

/// A controller paired with the headset.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Controller {
    pub serial: String,
    pub connected: bool,
}

/// Disconnects the controller with this serial. It stays paired and reconnects when woken. An
/// unknown serial does nothing.
pub async fn disconnect_controller(serial: &str) -> Result<(), DisconnectError> {
    tokio::time::timeout(TIMEOUT, send_request(request(serial)))
        .await
        .unwrap_or(Err(DisconnectError::RuntimeUnavailable))
}

/// The request packet: the serial, at most [`MAX_SERIAL_LENGTH`] bytes, in a
/// `disconnect_controller` body field 5, as its `serial_number` field 1.
fn request(serial: &str) -> Vec<u8> {
    let length = serial.len() as u8;
    let mut packet = REQUEST_HEADER.to_vec();
    packet.extend([0x2A, length + 2, 0x0A, length]);
    packet.extend(serial.as_bytes());
    packet
}

async fn send_request(packet: Vec<u8>) -> Result<(), DisconnectError> {
    let mut socket = open().await?;
    let sent = async {
        socket.send(Message::binary(packet)).await?;
        socket.close(None).await
    };
    sent.await.map_err(|_| DisconnectError::WriteFailed)
}

/// Opens a socket the way SteamVR's own pages do, and announces a Steam client on it.
async fn open() -> Result<Socket, DisconnectError> {
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
    socket
        .send(Message::text("steam_connect"))
        .await
        .map_err(|_| DisconnectError::WriteFailed)?;
    Ok(socket)
}

/// Publishes the headset's controllers on every change, for the life of the helper. The list is
/// empty while SteamVR on the headset does not answer.
pub async fn watch_controllers(hub: Arc<Hub>) {
    loop {
        if let Ok(Ok(mut socket)) = tokio::time::timeout(TIMEOUT, open()).await {
            poll_controllers(&mut socket, &hub).await;
        }
        hub.set_controllers(Vec::new());
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Asks for the pairing state every poll, and applies every state that arrives, until the socket
/// fails or goes quiet.
async fn poll_controllers(socket: &mut Socket, hub: &Hub) {
    let mut ticker = tokio::time::interval(POLL_INTERVAL);
    let mut last_state = Instant::now();
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if last_state.elapsed() > STATE_TIMEOUT
                    || socket.send(Message::binary(STATE_REQUEST.to_vec())).await.is_err()
                {
                    return;
                }
            }
            message = socket.next() => match message {
                Some(Ok(Message::Binary(packet))) => {
                    if let Some(controllers) = controllers(&packet) {
                        last_state = Instant::now();
                        hub.set_controllers(controllers);
                    }
                }
                Some(Ok(message)) if !message.is_close() => {}
                _ => return,
            },
        }
    }
}

/// The controllers in a pairing state packet, sorted by serial, or `None` for any other packet.
/// A packet is a header length byte, a header whose field 1 is the message type, then the body.
fn controllers(packet: &[u8]) -> Option<Vec<Controller>> {
    // read the message type from the header
    let (&header_length, rest) = packet.split_first()?;
    let header = rest.get(..header_length as usize)?;
    let body = &rest[header_length as usize..];
    let (_, message_type) = fields(header)?
        .into_iter()
        .find(|(number, _)| *number == 1)?;
    if !matches!(message_type, Field::Varint(STATE_MESSAGE)) {
        return None;
    }

    // collect connected_controller (field 3) and paired_controller (field 4), whose serial is
    // field 1; a connected controller can be in both
    let mut controllers: Vec<Controller> = Vec::new();
    for (number, field) in fields(body)? {
        let (3 | 4, Field::Bytes(controller)) = (number, field) else {
            continue;
        };
        let serial = fields(controller)?
            .into_iter()
            .find_map(|field| match field {
                (1, Field::Bytes(serial)) => std::str::from_utf8(serial).ok(),
                _ => None,
            })?;
        match controllers.iter_mut().find(|known| known.serial == serial) {
            Some(known) => known.connected |= number == 3,
            None => controllers.push(Controller {
                serial: serial.into(),
                connected: number == 3,
            }),
        }
    }
    controllers.sort_by(|a, b| a.serial.cmp(&b.serial));
    Some(controllers)
}

enum Field<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
    Fixed,
}

/// Splits a protobuf message into its numbered fields, or `None` when it is malformed.
fn fields(mut bytes: &[u8]) -> Option<Vec<(u64, Field<'_>)>> {
    let mut fields = Vec::new();
    while !bytes.is_empty() {
        let key = varint(&mut bytes)?;
        let field = match key & 7 {
            0 => Field::Varint(varint(&mut bytes)?),
            1 => {
                bytes = bytes.get(8..)?;
                Field::Fixed
            }
            2 => {
                let length = usize::try_from(varint(&mut bytes)?).ok()?;
                let value = bytes.get(..length)?;
                bytes = &bytes[length..];
                Field::Bytes(value)
            }
            5 => {
                bytes = bytes.get(4..)?;
                Field::Fixed
            }
            _ => return None,
        };
        fields.push((key >> 3, field));
    }
    Some(fields)
}

fn varint(bytes: &mut &[u8]) -> Option<u64> {
    let mut value = 0;
    for shift in (0..64).step_by(7) {
        let (&byte, rest) = bytes.split_first()?;
        *bytes = rest;
        value |= u64::from(byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_disconnect_request_steam_ui_sends() {
        assert_eq!(
            request("96c863a69af3"),
            [
                &[0x02, 0x08, 0x2D, 0x2A, 0x0E, 0x0A, 0x0C][..],
                b"96c863a69af3"
            ]
            .concat()
        );
    }

    #[test]
    fn reads_the_controllers_from_a_pairing_state() {
        let packet = [
            // header: message type 44
            &[0x02, 0x08, 0x2C][..],
            // total_connection_slots 2, is_pairing false
            &[0x08, 0x02, 0x10, 0x00],
            // connected_controller "bbb"
            &[0x1A, 0x05, 0x0A, 0x03],
            b"bbb",
            // paired_controller "bbb" with role 1, then paired_controller "aaa"
            &[0x22, 0x07, 0x0A, 0x03],
            b"bbb",
            &[0x10, 0x01, 0x22, 0x05, 0x0A, 0x03],
            b"aaa",
        ]
        .concat();
        let controller = |serial: &str, connected| Controller {
            serial: serial.into(),
            connected,
        };
        assert_eq!(
            controllers(&packet),
            Some(vec![controller("aaa", false), controller("bbb", true)])
        );
    }

    #[test]
    fn ignores_other_and_malformed_packets() {
        assert_eq!(controllers(&STATE_REQUEST), None);
        assert_eq!(controllers(&[0x02, 0x08, 0x2C, 0x1A, 0x09, 0x0A]), None);
        assert_eq!(controllers(&[0x02, 0x08, 0x2C]), Some(Vec::new()));
    }
}
