pub mod commands;

use std::{convert::Infallible, time::Duration};

use crate::utils::send_event;
use futures::executor::block_on;
use hyper::{body::Buf, Body, Request, Response};
use log::info;
use oyasumivr_shared::models::ElevatedSidecarInitRequest;
use sysinfo::{Pid, PidExt, System, SystemExt};
use tokio::sync::Mutex;

lazy_static! {
    static ref SIDECAR_HTTP_PORT: Mutex<Option<u16>> = Default::default();
    static ref SIDECAR_PID: Mutex<Option<u32>> = Default::default();
}

pub async fn get_base_url() -> Option<String> {
    let port_guard = SIDECAR_HTTP_PORT.lock().await;
    let port = match port_guard.as_ref() {
        Some(port) => *port,
        None => return None,
    };
    Some(format!("http://127.0.0.1:{port}"))
}

pub async fn active() -> Option<u32> {
    let url = match get_base_url().await {
        Some(base_url) => base_url + "/",
        None => return None,
    };
    let resp = reqwest::get(url).await;
    match resp {
        Ok(_) => {
            let pid_guard = SIDECAR_PID.lock().await;
            pid_guard.as_ref().copied()
        }
        Err(_) => None,
    }
}

pub async fn start() {
    if active().await.is_some() {
        return;
    }
    let port_guard = crate::http_server::PORT.lock().await;
    let port = match port_guard.as_ref() {
        Some(port) => *port,
        None => return,
    };
    info!("[Core] Starting sidecar...");
    tokio::spawn(async move {
        let (mut _rx, mut _child) =
            tauri::api::process::Command::new(String::from("oyasumi-elevated-sidecar.exe"))
                .args(vec![format!("{port}"), format!("{}", std::process::id())])
                .spawn()
                .expect("Could not spawn command");
    });
}

pub async fn request_stop() {
    let url = match get_base_url().await {
        Some(base_url) => base_url + "/stop",
        None => return,
    };
    info!("[Core] Stopping current sidecar...");
    let _ = reqwest::get(url).await;
}

pub async fn handle_elevated_sidecar_init(
    req: Request<Body>,
) -> Result<Response<Body>, Infallible> {
    // Parse request data
    let request_data: ElevatedSidecarInitRequest = serde_json::from_reader(
        hyper::body::to_bytes(req.into_body())
            .await
            .unwrap()
            .reader(),
    )
    .unwrap();
    // Stop current sidecar if it is running
    let current_sidecar_pid_guard = SIDECAR_PID.lock().await;
    let current_sidecar_pid = current_sidecar_pid_guard.as_ref();
    if current_sidecar_pid.is_some() {
        let stop_request = request_stop();
        block_on(stop_request);
    }
    drop(current_sidecar_pid_guard);
    // Save new sidecar details
    *SIDECAR_PID.lock().await = Some(request_data.sidecar_pid);
    *SIDECAR_HTTP_PORT.lock().await = Some(request_data.sidecar_port);
    // Watch the new sidecar for it quitting unexpectedly
    watch_process(request_data.sidecar_pid);
    // Inform the front that the sidecar has started
    info!(
        "[Core] Detected start of sidecar (pid={}, port={})",
        request_data.sidecar_pid, request_data.sidecar_port
    );
    send_event("ELEVATED_SIDECAR_STARTED", request_data.sidecar_pid).await;
    // OK
    Ok(Response::builder().status(200).body("OK".into()).unwrap())
}

fn watch_process(sidecar_pid: u32) {
    let pid = Pid::from_u32(sidecar_pid);
    let mut s = System::new_all();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            s.refresh_processes();
            if s.process(pid).is_none() {
                let current_sidecar_pid_guard = SIDECAR_PID.lock().await;
                let current_sidecar_pid = current_sidecar_pid_guard.as_ref();
                if match current_sidecar_pid {
                    Some(current_sidecar_pid) => *current_sidecar_pid == sidecar_pid,
                    None => true,
                } {
                    drop(current_sidecar_pid_guard);
                    *SIDECAR_PID.lock().await = None;
                    *SIDECAR_HTTP_PORT.lock().await = None;
                }
                send_event("ELEVATED_SIDECAR_STOPPED", sidecar_pid).await;
                info!("[Core] Sidecar has stopped (pid={})", sidecar_pid);
                break;
            }
        }
    });
}
