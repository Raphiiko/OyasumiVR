pub mod commands;
mod models;
mod vrchat;

use std::{
    io,
    net::{Ipv4Addr, UdpSocket},
    sync::LazyLock,
};

use log::{error, info, warn};
use models::{OSCMessage, OSCValue};
use rosc::{OscPacket, OscType};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::utils::send_event;

pub static OSC_SEND_SOCKET: LazyLock<Mutex<Option<UdpSocket>>> = LazyLock::new(Default::default);
pub static OSC_RECEIVE_SOCKET: LazyLock<Mutex<Option<UdpSocket>>> = LazyLock::new(Default::default);
pub static OSC_RECEIVE_ADDRESS_WHITELIST: LazyLock<Mutex<Vec<String>>> = LazyLock::new(Default::default);
pub static VRC_OSC_ADDRESS: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));
pub static VRC_OSCQUERY_ADDRESS: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

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
    // Spawn OSCQuery client task
    spawn_oscquery_client_task().await;
}

async fn spawn_oscquery_client_task() {
    tokio::spawn(async {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            let mut oscquery_addr = oyasumivr_oscquery::client::get_vrchat_oscquery_address().await;
            if let Some((host, port)) = oscquery_addr.clone() {
                let response = reqwest::get(format!("http://{}:{}/?HOST_INFO", host, port)).await;
                if response.is_err() || response.as_ref().unwrap().status() != 200 {
                    oscquery_addr = None;
                }
            }
            let osc_addr = if oscquery_addr.is_some() {
                oyasumivr_oscquery::client::get_vrchat_osc_address().await
            } else {
                None
            };
            set_vr_chat_osc_query_address(oscquery_addr).await;
            set_vr_chat_osc_address(osc_addr).await;
        }
    });
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
                        if let Some(OscPacket::Message(msg)) = result {
                            vrchat::process_event(msg.clone()).await;
                            // check if address is whitelisted
                            let address_whitelist_guard =
                                OSC_RECEIVE_ADDRESS_WHITELIST.lock().await;
                            let address_whitelist = address_whitelist_guard.clone();
                            drop(address_whitelist_guard);
                            if address_whitelist.contains(&msg.addr) {
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

pub async fn set_vr_chat_osc_query_address(addr: Option<(String, u16)>) {
    let address = addr.map(|(host, port)| format!("{}:{}", host, port));
    let current_address = VRC_OSCQUERY_ADDRESS.lock().await.clone();

    if current_address != address {
        if let Some(ref addr) = address.clone() {
            info!("[Core] Found VRChat OSCQuery address on {}", addr);
        }
        *VRC_OSCQUERY_ADDRESS.lock().await = address.clone();
        send_event("VRC_OSCQUERY_ADDRESS_CHANGED", address.clone()).await;
    }
}

pub async fn set_vr_chat_osc_address(addr: Option<(String, u16)>) {
    let address = addr.map(|(host, port)| format!("{}:{}", host, port));
    let current_address = VRC_OSC_ADDRESS.lock().await.clone();

    if current_address != address {
        if let Some(ref addr) = address {
            info!("[Core] Found VRChat OSC address on {}", addr);
        }
        *VRC_OSC_ADDRESS.lock().await = address.clone();
        send_event("VRC_OSC_ADDRESS_CHANGED", address).await;
    }
}
