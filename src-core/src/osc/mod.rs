pub mod commands;
mod models;
mod vrchat;

use std::{
    io,
    net::{Ipv4Addr, UdpSocket},
};

use log::{error, info, warn};
use models::{OSCMessage, OSCValue};
use rosc::{OscPacket, OscType};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::utils::send_event;

lazy_static! {
    static ref OSC_SEND_SOCKET: Mutex<Option<UdpSocket>> = Default::default();
    static ref OSC_RECEIVE_SOCKET: Mutex<Option<UdpSocket>> = Default::default();
    static ref OSC_RECEIVE_ADDRESS_WHITELIST: Mutex<Vec<String>> = Default::default();
    static ref VRC_OSC_ADDRESS: Mutex<Option<String>> = Mutex::new(None);
    static ref VRC_OSCQUERY_ADDRESS: Mutex<Option<String>> = Mutex::new(None);
}

pub async fn init() {
    // Setup sending socket
    *OSC_SEND_SOCKET.lock().await = match UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) {
        Ok(s) => Some(s),
        Err(err) => {
            error!(
                "[Core] Could not initialize send socket for OSC module: {}",
                err
            );
            return;
        }
    };
    // Start looking for VRChat's OSC and OSCQuery services
    if !crate::globals::is_flag_set("DISABLE_MDNS").await {
        match oyasumivr_oscquery::client::init().await {
            Err(err) => error!("[Core] Could not initialize OSCQuery client: {:#?}", err),
            _ => {}
        };
        tokio::task::spawn(async {
            loop {
                {
                    let address = get_vrchat_osc_address().await;
                    let mut vrc_osc_address_guard = VRC_OSC_ADDRESS.lock().await;
                    if !match (&address, vrc_osc_address_guard.as_ref()) {
                        (Some(str1), Some(str2)) => str1 == str2,
                        (None, None) => true,
                        _ => false,
                    } {
                        *vrc_osc_address_guard = address;
                        send_event("VRC_OSC_ADDRESS_CHANGED", vrc_osc_address_guard.clone()).await;
                    }
                }
                {
                    let address = get_vrchat_oscquery_address().await;
                    let mut vrc_oscquery_address_guard = VRC_OSCQUERY_ADDRESS.lock().await;
                    if !match (&address, vrc_oscquery_address_guard.as_ref()) {
                        (Some(str1), Some(str2)) => str1 == str2,
                        (None, None) => true,
                        _ => false,
                    } {
                        *vrc_oscquery_address_guard = address;
                        send_event(
                            "VRC_OSCQUERY_ADDRESS_CHANGED",
                            vrc_oscquery_address_guard.clone(),
                        )
                        .await;
                    }
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }
        });
    }
}

async fn spawn_receiver_task() -> CancellationToken {
    info!("[Core] Starting OSC receiver task");
    let cancellation_token = CancellationToken::new();
    let cancellation_token_internal = cancellation_token.clone();
    tokio::spawn(async move {
        'outer: while !cancellation_token_internal.is_cancelled() {
            tokio::time::sleep(tokio::time::Duration::from_millis(16)).await;
            let socket_guard = OSC_RECEIVE_SOCKET.lock().await;
            let socket = match socket_guard.as_ref() {
                Some(s) => s,
                None => continue,
            };
            loop {
                let mut buf = [0u8; rosc::decoder::MTU];
                match socket.recv(&mut buf) {
                    Ok(size) => {
                        let result = match rosc::decoder::decode_udp(&buf[..size]) {
                            Ok((_, packet)) => Some(packet),
                            Err(err) => {
                                warn!(
                                    "[Core] Expected OSC packet, but UDP packet was malformed: {}",
                                    err
                                );
                                None
                            }
                        };
                        if let Some(packet) = result {
                            if let OscPacket::Message(msg) = packet {
                                vrchat::process_event(msg.clone()).await;
                                // check if address is whitelisted
                                let address_whitelist_guard =
                                    OSC_RECEIVE_ADDRESS_WHITELIST.lock().await;
                                if address_whitelist_guard.contains(&msg.addr) {
                                    send_event(
                                        "OSC_MESSAGE",
                                        OSCMessage {
                                            address: msg.addr,
                                            values: msg
                                                .args
                                                .iter()
                                                .map(|value| match value {
                                                    OscType::Int(v) => OSCValue {
                                                        kind: "int".into(),
                                                        value: Some(v.to_string()),
                                                    },
                                                    OscType::Float(v) => OSCValue {
                                                        kind: "float".into(),
                                                        value: Some(v.to_string()),
                                                    },
                                                    OscType::String(v) => OSCValue {
                                                        kind: "string".into(),
                                                        value: Some(v.clone()),
                                                    },
                                                    OscType::Bool(v) => OSCValue {
                                                        kind: "bool".into(),
                                                        value: Some(v.to_string()),
                                                    },
                                                    _ => OSCValue {
                                                        kind: "unsupported".into(),
                                                        value: None,
                                                    },
                                                })
                                                .collect(),
                                        },
                                    )
                                    .await;
                                }
                            }
                        }
                    }
                    Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                        break;
                    }
                    Err(e) => {
                        error!("[Core] Error receiving on OSC socket: {}", e);
                        error!("[Core] Terminated OSC receiver task.");
                        break 'outer;
                    }
                }
            }
        }
        info!("[Core] Terminated OSC receiver task");
    });
    cancellation_token
}

async fn get_vrchat_osc_address() -> Option<String> {
    if crate::globals::is_flag_set("DISABLE_MDNS").await {
        return None;
    }
    let addr = oyasumivr_oscquery::client::get_vrchat_osc_address().await;
    match addr {
        Some(addr) => Some(format!("{}:{}", addr.0, addr.1)),
        None => None,
    }
}

async fn get_vrchat_oscquery_address() -> Option<String> {
    if crate::globals::is_flag_set("DISABLE_MDNS").await {
        return None;
    }
    let addr = oyasumivr_oscquery::client::get_vrchat_oscquery_address().await;
    match addr {
        Some(addr) => Some(format!("{}:{}", addr.0, addr.1)),
        None => None,
    }
}
