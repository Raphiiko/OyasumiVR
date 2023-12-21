use super::{OSC_RECEIVE_SOCKET, OSC_SEND_SOCKET};
use log::{debug, error, info};
use oyasumivr_oscquery::OSCMethod;
use rosc::{encoder, OscMessage, OscPacket, OscType};
use std::{
    net::{SocketAddrV4, UdpSocket},
    str::FromStr,
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

lazy_static! {
    static ref CANCELLATION_TOKEN: Mutex<Option<CancellationToken>> = Default::default();
}

#[tauri::command]
pub async fn get_vrchat_osc_address() -> Option<String> {
    let addr = oyasumivr_oscquery::client::get_vrchat_osc_address().await;
    match addr {
        Some(addr) => Some(format!("{}:{}", addr.0, addr.1)),
        None => None,
    }
}

#[tauri::command]
pub async fn get_vrchat_oscquery_address() -> Option<String> {
    let addr = oyasumivr_oscquery::client::get_vrchat_oscquery_address().await;
    match addr {
        Some(addr) => Some(format!("{}:{}", addr.0, addr.1)),
        None => None,
    }
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
        match oyasumivr_oscquery::server::deinit().await {
            Err(err) => error!("[Core] Could not terminate OSCQuery server: {:#?}", err),
            _ => {}
        };
    }
    let mut receive_socket_guard = OSC_RECEIVE_SOCKET.lock().await;
    *receive_socket_guard = None;
}

#[tauri::command]
pub async fn start_osc_server() -> Option<(String, Option<String>)> {
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
    let osc_query_addr_string =
        match oyasumivr_oscquery::server::init("OyasumiVR", "127.0.0.1", osc_addr_port).await {
            Ok(result) => Some(format!("{}:{}", result.0, result.1)),
            Err(err) => {
                error!("[Core] Could not initialize OSCQuery server: {:#?}", err);
                None
            }
        };
    oyasumivr_oscquery::server::receive_vrchat_avatar_parameters().await;
    match oyasumivr_oscquery::server::advertise().await {
        Err(err) => error!("[Core] Could not advertise OSCQuery server: {:#?}", err),
        _ => {}
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
pub async fn osc_send_int(addr: String, osc_addr: String, data: i32) -> Result<bool, String> {
    debug!(
        "[Core] Sending OSC command (address={}, type={}, value={})",
        osc_addr, "int", data
    );
    osc_send(addr, osc_addr, vec![OscType::Int(data)]).await
}

#[tauri::command]
pub async fn osc_send_float(addr: String, osc_addr: String, data: f32) -> Result<bool, String> {
    debug!(
        "[Core] Sending OSC command (address={}, type={}, value={})",
        osc_addr, "float", data
    );
    osc_send(addr, osc_addr, vec![OscType::Float(data)]).await
}

#[tauri::command]
pub async fn osc_send_bool(addr: String, osc_addr: String, data: bool) -> Result<bool, String> {
    debug!(
        "[Core] Sending OSC command (address={}, type={}, value={})",
        osc_addr, "bool", data
    );
    osc_send(addr, osc_addr, vec![OscType::Bool(data)]).await
}

#[tauri::command]
pub fn osc_valid_addr(addr: String) -> bool {
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
