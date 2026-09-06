use super::{OSC_RECEIVE_SOCKET, OSC_SEND_SOCKET};
use log::{debug, error, info};
use oyasumivr_oscquery::OSCMethod;
use rosc::{encoder, OscMessage, OscPacket, OscType};
use serde::{Deserialize, Serialize};
use std::{
    net::{SocketAddr, SocketAddrV4, UdpSocket},
    str::FromStr,
    sync::LazyLock,
    time::Duration,
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const MDNS_SIDECAR_PATH: &str = "resources/oyasumivr-mdns-sidecar.exe";

#[derive(Serialize, Deserialize, Debug)]
pub enum SupportedOscType {
    Int,
    Float,
    Boolean,
    String,
}

static CANCELLATION_TOKEN: LazyLock<Mutex<Option<CancellationToken>>> =
    LazyLock::new(Default::default);

#[tauri::command]
pub async fn get_vrchat_osc_address() -> Option<String> {
    let guard = super::VRC_OSC_ADDRESS.lock().await;
    guard.as_ref().cloned()
}

#[tauri::command]
pub async fn get_vrchat_oscquery_address() -> Option<String> {
    let guard = super::VRC_OSCQUERY_ADDRESS.lock().await;
    guard.as_ref().cloned()
}

#[tauri::command]
pub async fn stop_osc_server() {
    // Terminate existing task if it exists
    let mut cancellation_token = CANCELLATION_TOKEN.lock().await;
    if let Some(token) = cancellation_token.as_ref() {
        info!("[Core] Stopping OSC server");
        token.cancel();
        *cancellation_token = None;
        // Terminate OSCQuery server
        if let Err(err) = oyasumivr_oscquery::server::deinit().await {
            error!("[Core] Could not terminate OSCQuery server: {err:#?}")
        };
        // Terminate OSCQuery client
        if let Err(err) = oyasumivr_oscquery::client::deinit().await {
            error!("[Core] Could not terminate OSCQuery client: {err:#?}")
        };
    }
    let mut receive_socket_guard = OSC_RECEIVE_SOCKET.lock().await;
    *receive_socket_guard = None;
}

#[tauri::command]
pub async fn start_osc_server() -> Option<(String, String)> {
    info!("[Core] Starting OSC server");
    stop_osc_server().await;
    // Setup receiving socket
    let receive_addr = match SocketAddrV4::from_str("0.0.0.0:0") {
        Ok(addr) => addr,
        Err(err) => {
            error!("[Core] Could not initialize receive socket for OSC module (addr init): {err}");
            return None;
        }
    };
    let receive_socket = match UdpSocket::bind(receive_addr) {
        Ok(s) => s,
        Err(err) => {
            error!(
                "[Core] Could not initialize receive socket for OSC module (socket init): {err}"
            );
            return None;
        }
    };
    receive_socket.set_nonblocking(true).unwrap();
    let osc_addr_string = receive_socket.local_addr().unwrap().to_string();
    let osc_addr_port = receive_socket.local_addr().unwrap().port();
    info!("[Core] OSC server listening on {osc_addr_string}");
    *OSC_RECEIVE_SOCKET.lock().await = Some(receive_socket);
    // Process incoming messages
    let cancellation_token = super::spawn_receiver_task().await;
    *CANCELLATION_TOKEN.lock().await = Some(cancellation_token);
    // Start the OSCQuery server
    let osc_query_addr_string =
        match oyasumivr_oscquery::server::init("OyasumiVR", osc_addr_port, MDNS_SIDECAR_PATH).await
        {
            Ok((addr, port)) => {
                info!("[Core] OSCQuery server listening on {addr}:{port}");
                format!("{addr}:{port}")
            }
            Err(e) => {
                error!("[Core] Failed to start OSCQuery server: {e:#?}");
                stop_osc_server().await;
                return None;
            }
        };
    oyasumivr_oscquery::server::receive_vrchat_avatar_parameters().await;
    if let Err(e) = oyasumivr_oscquery::server::advertise().await {
        error!("[Core] Failed to advertise OSCQuery server: {e:#?}");
        stop_osc_server().await;
        let _ = oyasumivr_oscquery::server::deinit().await;
        return None;
    }
    // Setup the OSCQuery client
    match oyasumivr_oscquery::client::init(MDNS_SIDECAR_PATH).await {
        Ok(_) => {
            info!("[Core] OSCQuery client initialized");
        }
        Err(e) => {
            error!("[Core] Failed to initialize OSCQuery client: {e:#?}");
            stop_osc_server().await;
            let _ = oyasumivr_oscquery::client::deinit().await;
            let _ = oyasumivr_oscquery::server::deinit().await;
            return None;
        }
    }
    // Return bound address
    Some((osc_addr_string, osc_query_addr_string))
}

#[tauri::command]
pub async fn add_osc_method(method: OSCMethod) {
    oyasumivr_oscquery::server::add_osc_method(method).await;
}

#[tauri::command]
pub async fn set_osc_method_value(address: String, value: String) {
    oyasumivr_oscquery::server::set_osc_method_value(address, Some(value)).await;
}

#[tauri::command]
pub async fn osc_send_command(
    addr: String,
    osc_addr: String,
    types: Vec<SupportedOscType>,
    values: Vec<String>,
) -> Result<bool, String> {
    debug!("[Core] Sending OSC command (address={osc_addr}, types={types:?}, values={values:?})");

    let mut data = Vec::new();

    for (osc_type, value) in types.into_iter().zip(values) {
        let osc_value = match osc_type {
            SupportedOscType::Int => value
                .parse::<i32>()
                .map(OscType::Int)
                .map_err(|_| String::from("INVALID_INT_VALUE"))?,
            SupportedOscType::Float => value
                .parse::<f32>()
                .map(OscType::Float)
                .map_err(|_| String::from("INVALID_FLOAT_VALUE"))?,
            SupportedOscType::Boolean => value
                .parse::<bool>()
                .map(OscType::Bool)
                .map_err(|_| String::from("INVALID_BOOL_VALUE"))?,
            SupportedOscType::String => OscType::String(value),
        };
        data.push(osc_value);
    }

    osc_send(addr, osc_addr, data).await
}

#[tauri::command]
pub async fn osc_valid_addr(addr: String) -> bool {
    resolve_osc_address(&addr).await.is_ok()
}

async fn resolve_osc_address(addr: &str) -> Result<SocketAddr, String> {
    tokio::time::timeout(Duration::from_secs(5), tokio::net::lookup_host(addr))
        .await
        .ok()
        .and_then(Result::ok)
        .and_then(|mut addresses| addresses.find(SocketAddr::is_ipv4))
        .ok_or_else(|| "INVALID_ADDRESS".to_string())
}

async fn osc_send(addr: String, osc_addr: String, data: Vec<OscType>) -> Result<bool, String> {
    // resolve an IPv4 destination before locking the sender
    let to_addr = resolve_osc_address(&addr).await?;

    let socket_guard = OSC_SEND_SOCKET.lock().await;
    let socket = match socket_guard.as_ref() {
        Some(socket) => socket,
        None => return Err(String::from("NO_SOCKET")),
    };
    // encode the address and typed arguments into one packet
    let msg_buf = encoder::encode(&OscPacket::Message(OscMessage {
        addr: osc_addr.clone(),
        args: data.clone(),
    }))
    .unwrap();
    // send the packet through the shared IPv4 socket
    if socket.send_to(&msg_buf, to_addr).is_err() {
        error!(
            "[Core] Failed to send OSC message (addr={addr}, osc_addr={osc_addr}, data={data:?})"
        );
        return Err(String::from("SENDING_ERROR"));
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolves_ipv4_hosts_and_sends_a_loopback_packet() {
        for host in ["127.0.0.1", "localhost"] {
            assert!(osc_valid_addr(format!("{host}:9000")).await);
            assert!(resolve_osc_address(&format!("{host}:9000"))
                .await
                .unwrap()
                .is_ipv4());
        }
        #[cfg(windows)]
        assert!(osc_valid_addr(format!("{}:9000", std::env::var("COMPUTERNAME").unwrap())).await);
        for addr in [
            "no-port",
            "invalid host:9000",
            "[::1]:9000",
            "localhost:65536",
            "oyasumivr-no-such-host.invalid:9000",
        ] {
            assert!(!osc_valid_addr(addr.into()).await);
        }

        let receiver = UdpSocket::bind("127.0.0.1:0").unwrap();
        receiver
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        *OSC_SEND_SOCKET.lock().await = Some(UdpSocket::bind("127.0.0.1:0").unwrap());
        let result = osc_send(
            format!("localhost:{}", receiver.local_addr().unwrap().port()),
            "/oyasumi/test".into(),
            vec![OscType::Int(7)],
        )
        .await;
        *OSC_SEND_SOCKET.lock().await = None;
        assert_eq!(result, Ok(true));
        let mut buffer = [0; 128];
        let (size, _) = receiver.recv_from(&mut buffer).unwrap();
        let (_, packet) = rosc::decoder::decode_udp(&buffer[..size]).unwrap();
        assert_eq!(
            packet,
            OscPacket::Message(OscMessage {
                addr: "/oyasumi/test".into(),
                args: vec![OscType::Int(7)]
            })
        );
    }
}

#[tauri::command]
pub async fn set_osc_receive_address_whitelist(whitelist: Vec<String>) {
    *super::OSC_RECEIVE_ADDRESS_WHITELIST.lock().await = whitelist;
}
