use std::{
    net::{Ipv4Addr, SocketAddrV4, UdpSocket},
    str::FromStr,
};

use rosc::{encoder, OscMessage, OscPacket, OscType};

use crate::OSC_SOCKET;

#[tauri::command]
pub fn osc_init() -> bool {
    *OSC_SOCKET.lock().unwrap() = match UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) {
        Ok(s) => Some(s),
        Err(err) => {
            eprintln!("{err}");
            return false;
        }
    };
    true
}

#[tauri::command]
pub fn osc_send_int(addr: String, osc_addr: String, data: i32) -> Result<bool, String> {
    osc_send(addr, osc_addr, vec![OscType::Int(data)])
}

#[tauri::command]
pub fn osc_send_float(addr: String, osc_addr: String, data: f32) -> Result<bool, String> {
    osc_send(addr, osc_addr, vec![OscType::Float(data)])
}

#[tauri::command]
pub fn osc_send_bool(addr: String, osc_addr: String, data: bool) -> Result<bool, String> {
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
    let socket_guard = OSC_SOCKET.lock().unwrap();
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
        addr: osc_addr,
        args: data,
    }))
    .unwrap();
    // Send message
    match socket.send_to(&msg_buf, to_addr) {
        Err(_) => return Err(String::from("SENDING_ERROR")),
        _ => (),
    }
    Ok(true)
}
