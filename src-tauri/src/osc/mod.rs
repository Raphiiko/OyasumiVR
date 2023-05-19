pub mod commands;
mod models;

use std::{
    io,
    net::{Ipv4Addr, UdpSocket},
    sync::mpsc::{self, TryRecvError},
};

use log::{error, info};
use rosc::{OscPacket, OscType};
use tokio::sync::Mutex;
use models::{OSCMessage, OSCValue};

use crate::utils::send_event;

lazy_static! {
    static ref OSC_SEND_SOCKET: Mutex<Option<UdpSocket>> = Default::default();
    static ref OSC_RECEIVE_SOCKET: Mutex<Option<UdpSocket>> = Default::default();
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
}

async fn spawn_receiver_task() -> mpsc::Sender<()> {
    info!("[Core] Starting OSC receiver task");
    let (termination_tx, termination_rx) = mpsc::channel::<()>();
    tokio::spawn(async move {
        loop {
            let socket_guard = OSC_RECEIVE_SOCKET.lock().await;
            let socket = socket_guard.as_ref().unwrap();
            // Check if we have to terminate this task
            let val = termination_rx.try_recv();
            match val {
                Ok(_) | Err(TryRecvError::Disconnected) => {
                    // Break to terminate this task
                    info!("[Core] Terminated OSC receiver task");
                    break;
                }
                Err(TryRecvError::Empty) => (),
            }
            let mut buf = [0u8; rosc::decoder::MTU];
            match socket.recv(&mut buf) {
                Ok(size) => {
                    let (_, packet) = rosc::decoder::decode_udp(&buf[..size]).unwrap();
                    if let OscPacket::Message(msg) = packet {
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
                        ).await;
                    }
                }
                Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {}
                Err(e) => {
                    error!("[Core] Error receiving on OSC socket: {}", e);
                    error!("[Core] Terminated OSC receiver thread.");
                    break;
                }
            }
        }
    });
    // Return OSC Retrieval thread terminator
    termination_tx
}
