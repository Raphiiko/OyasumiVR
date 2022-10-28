use std::{
    net::{Ipv4Addr, SocketAddrV4, UdpSocket},
    str::FromStr,
    sync::{mpsc, Mutex},
};

use log::{debug, error};
use rosc::{encoder, OscMessage, OscPacket, OscType};
use serde::{Deserialize, Serialize};

use crate::{background, OSC_RECEIVE_SOCKET, OSC_SEND_SOCKET};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OSCValue {
    pub kind: String,
    pub value: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OSCMessage {
    pub address: String,
    pub values: Vec<OSCValue>,
}

lazy_static! {
    static ref TERMINATION_TX: Mutex<Option<mpsc::Sender<()>>> = Default::default();
}

#[tauri::command]
pub fn osc_init(receive_addr: String) -> bool {
    // Terminate existing thread if it exists
    let termination_guard = TERMINATION_TX.lock().unwrap();
    let termination = termination_guard.as_ref();
    if termination.is_some() {
        termination.unwrap().send(()).unwrap();
    }
    drop(termination_guard);
    // Setup sending socket
    *OSC_SEND_SOCKET.lock().unwrap() = match UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) {
        Ok(s) => Some(s),
        Err(err) => {
            error!(
                "[Core] Could not initialize send socket for OSC module: {}",
                err
            );
            return false;
        }
    };
    // Setup receiving socket if needed
    let receive_socket_guard = OSC_RECEIVE_SOCKET.lock().unwrap();
    if receive_socket_guard.is_none() {
        drop(receive_socket_guard);
        let receive_addr = match SocketAddrV4::from_str(receive_addr.as_str()) {
            Ok(addr) => addr,
            Err(err) => {
                error!(
                    "[Core] Could not initialize receive socket for OSC module (addr init): {}",
                    err
                );
                return false;
            }
        };
        let receive_socket = match UdpSocket::bind(receive_addr) {
            Ok(s) => s,
            Err(err) => {
                error!(
                    "[Core] Could not initialize receive socket for OSC module (socket init): {}",
                    err
                );
                return false;
            }
        };
        receive_socket.set_nonblocking(true).unwrap();
        *OSC_RECEIVE_SOCKET.lock().unwrap() = Some(receive_socket);
    }
    // Process incoming messages
    let termination_tx = background::osc::spawn_osc_receiver_thread();
    *TERMINATION_TX.lock().unwrap() = Some(termination_tx);
    true
}

#[tauri::command]
pub fn osc_send_int(addr: String, osc_addr: String, data: i32) -> Result<bool, String> {
    debug!(
        "[Core] Sending OSC command (address={}, type={}, value={})",
        osc_addr, "int", data
    );
    osc_send(addr, osc_addr, vec![OscType::Int(data)])
}

#[tauri::command]
pub fn osc_send_float(addr: String, osc_addr: String, data: f32) -> Result<bool, String> {
    debug!(
        "[Core] Sending OSC command (address={}, type={}, value={})",
        osc_addr, "float", data
    );
    osc_send(addr, osc_addr, vec![OscType::Float(data)])
}

#[tauri::command]
pub fn osc_send_bool(addr: String, osc_addr: String, data: bool) -> Result<bool, String> {
    debug!(
        "[Core] Sending OSC command (address={}, type={}, value={})",
        osc_addr, "bool", data
    );
    osc_send(addr, osc_addr, vec![OscType::Bool(data)])
}

#[tauri::command]
pub fn osc_valid_addr(addr: String) -> bool {
    match SocketAddrV4::from_str(addr.as_str()) {
        Ok(_) => true,
        Err(_) => false,
    }
}

fn osc_send(addr: String, osc_addr: String, data: Vec<OscType>) -> Result<bool, String> {
    // Get socket
    let socket_guard = OSC_SEND_SOCKET.lock().unwrap();
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
    match socket.send_to(&msg_buf, to_addr) {
        Err(_) => {
            error!(
                "[Core] Failed to send OSC message (addr={}, osc_addr={}, data={:?})",
                addr, osc_addr, data
            );
            return Err(String::from("SENDING_ERROR"));
        }
        _ => (),
    }
    Ok(true)
}
