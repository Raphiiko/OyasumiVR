use super::{OSC_RECEIVE_SOCKET, OSC_SEND_SOCKET};
use log::{debug, error, info};
use oyasumivr_oscquery::OSCMethod;
use rosc::{encoder, OscMessage, OscPacket, OscType};
use serde::{Deserialize, Serialize};
use std::{
    net::{SocketAddrV4, UdpSocket},
    str::FromStr,
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize, Debug)]
pub enum SupportedOscType {
    INT,
    FLOAT,
    BOOLEAN,
    STRING,
}

lazy_static! {
    static ref CANCELLATION_TOKEN: Mutex<Option<CancellationToken>> = Default::default();
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn get_vrchat_osc_address() -> Option<String> {
    let guard = super::VRC_OSC_ADDRESS.lock().await;
    guard.as_ref().cloned()
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn get_vrchat_oscquery_address() -> Option<String> {
    let guard = super::VRC_OSCQUERY_ADDRESS.lock().await;
    guard.as_ref().cloned()
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn stop_osc_server() {
    // Terminate existing task if it exists
    let mut cancellation_token = CANCELLATION_TOKEN.lock().await;
    if let Some(token) = cancellation_token.as_ref() {
        info!("[Core] Stopping OSC server");
        token.cancel();
        *cancellation_token = None;
        // Terminate OSCQuery server
        match oyasumivr_oscquery::server::deinit().await {
            Err(err) => error!("[Core] Could not terminate OSCQuery server: {:#?}", err),
            _ => {}
        };
    }
    let mut receive_socket_guard = OSC_RECEIVE_SOCKET.lock().await;
    *receive_socket_guard = None;
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn start_osc_server() -> Option<(String, String)> {
    info!("[Core] Starting OSC server");
    stop_osc_server().await;
    // Setup receiving socket
    let receive_addr = match SocketAddrV4::from_str("0.0.0.0:0") {
        Ok(addr) => addr,
        Err(err) => {
            error!(
                "[Core] Could not initialize receive socket for OSC module (addr init): {}",
                err
            );
            return None;
        }
    };
    let receive_socket = match UdpSocket::bind(receive_addr) {
        Ok(s) => s,
        Err(err) => {
            error!(
                "[Core] Could not initialize receive socket for OSC module (socket init): {}",
                err
            );
            return None;
        }
    };
    receive_socket.set_nonblocking(true).unwrap();
    let osc_addr_string = receive_socket.local_addr().unwrap().to_string();
    let osc_addr_port = receive_socket.local_addr().unwrap().port();
    info!("[Core] OSC server listening on {}", osc_addr_string);
    *OSC_RECEIVE_SOCKET.lock().await = Some(receive_socket);
    // Process incoming messages
    let cancellation_token = super::spawn_receiver_task().await;
    *CANCELLATION_TOKEN.lock().await = Some(cancellation_token);
    // Start the OSCQuery server
    let osc_query_addr =
        oyasumivr_oscquery::server::init("OyasumiVR", "127.0.0.1", osc_addr_port, false).await;
    if osc_query_addr.is_err() {
        error!(
            "[Core] Could not initialize OSCQuery server: {:#?}",
            osc_query_addr.err()
        );
        return None;
    };
    let osc_query_addr = osc_query_addr.unwrap();
    let osc_query_addr_string = format!("{}:{}", osc_query_addr.0, osc_query_addr.1);
    oyasumivr_oscquery::server::receive_vrchat_avatar_parameters().await;
    crate::mdns_sidecar::start_mdns_sidecar(osc_addr_port, osc_query_addr.1).await;
    // Return bound address
    Some((osc_addr_string, osc_query_addr_string))
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn add_osc_method(method: OSCMethod) {
    oyasumivr_oscquery::server::add_osc_method(method).await;
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn set_osc_method_value(address: String, value: String) {
    oyasumivr_oscquery::server::set_osc_method_value(address, Some(value)).await;
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn osc_send_command(
    addr: String,
    osc_addr: String,
    types: Vec<SupportedOscType>,
    values: Vec<String>,
) -> Result<bool, String> {
    debug!(
        "[Core] Sending OSC command (address={}, types={:?}, values={:?})",
        osc_addr, types, values
    );

    let mut data = Vec::new();

    for (osc_type, value) in types.into_iter().zip(values.into_iter()) {
        let osc_value = match osc_type {
            SupportedOscType::INT => value
                .parse::<i32>()
                .map(OscType::Int)
                .map_err(|_| String::from("INVALID_INT_VALUE"))?,
            SupportedOscType::FLOAT => value
                .parse::<f32>()
                .map(OscType::Float)
                .map_err(|_| String::from("INVALID_FLOAT_VALUE"))?,
            SupportedOscType::BOOLEAN => value
                .parse::<bool>()
                .map(OscType::Bool)
                .map_err(|_| String::from("INVALID_BOOL_VALUE"))?,
            SupportedOscType::STRING => OscType::String(value),
        };
        data.push(osc_value);
    }

    osc_send(addr, osc_addr, data).await
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn osc_valid_addr(addr: String) -> bool {
    SocketAddrV4::from_str(addr.as_str()).is_ok()
}

async fn osc_send(addr: String, osc_addr: String, data: Vec<OscType>) -> Result<bool, String> {
    // Get socket
    let socket_guard = OSC_SEND_SOCKET.lock().await;
    let socket = match socket_guard.as_ref() {
        Some(socket) => socket,
        None => return Err(String::from("NO_SOCKET")),
    };
    // Parse address
    let to_addr = match SocketAddrV4::from_str(addr.as_str()) {
        Ok(addr) => addr,
        Err(_) => return Err(String::from("INVALID_ADDRESS")),
    };
    // Construct message
    let msg_buf = encoder::encode(&OscPacket::Message(OscMessage {
        addr: osc_addr.clone(),
        args: data.clone(),
    }))
    .unwrap();
    // Send message
    if socket.send_to(&msg_buf, to_addr).is_err() {
        error!(
            "[Core] Failed to send OSC message (addr={}, osc_addr={}, data={:?})",
            addr, osc_addr, data
        );
        return Err(String::from("SENDING_ERROR"));
    }
    Ok(true)
}

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn set_osc_receive_address_whitelist(whitelist: Vec<String>) {
    *super::OSC_RECEIVE_ADDRESS_WHITELIST.lock().await = whitelist;
}
