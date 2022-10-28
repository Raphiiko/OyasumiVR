use std::{
    sync::mpsc::{self, TryRecvError},
    thread, io,
};

use log::{info, error};
use rosc::{OscPacket, OscType};

use crate::{
    commands::osc::{OSCMessage, OSCValue},
    OSC_RECEIVE_SOCKET, TAURI_WINDOW,
};

pub fn spawn_osc_receiver_thread() -> mpsc::Sender<()> {
    info!("[Core] Starting OSC receiver thread");
    let (termination_tx, termination_rx) = mpsc::channel::<()>();
    thread::spawn(move || {
        loop {
            let socket_guard = OSC_RECEIVE_SOCKET.lock().unwrap();
            let socket = socket_guard.as_ref().unwrap();
            // Check if we have to terminate this thread
            let val = termination_rx.try_recv();
            match val {
                Ok(_) | Err(TryRecvError::Disconnected) => {
                    // Break to terminate this thread
                    info!("[Core] Terminated OSC receiver thread");
                    break;
                }
                Err(TryRecvError::Empty) => (),
            }
            let mut buf = [0u8; rosc::decoder::MTU];
            match socket.recv(&mut buf) {
                Ok(size) => {
                    let (_, packet) = rosc::decoder::decode_udp(&buf[..size]).unwrap();
                    match packet {
                        OscPacket::Message(msg) => {
                            let window_guard = TAURI_WINDOW.lock().unwrap();
                            let window = window_guard.as_ref().unwrap();
                            let _ = window.emit(
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
                            );
                        }
                        _ => (),
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
