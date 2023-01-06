#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
#[macro_use(lazy_static)]
extern crate lazy_static;
use hyper::service::{make_service_fn, service_fn};
use hyper::Server;
use oyasumi_shared::models::ElevatedSidecarInitRequest;
use std::convert::Infallible;
use std::env;
use std::net::SocketAddr;
use std::time::Duration;
use sysinfo::{Pid, PidExt, System, SystemExt};
use windows::{is_elevated, relaunch_with_elevation};
mod http_handler;
mod nvml;
mod windows;
mod afterburner;

#[tokio::main]
async fn main() {
    // Get port of host http server from 1st argument
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        println!("Missing arguments. Expected format");
        println!("oyasumi-admin.exe [main-http-port] [main-process-id]");
        std::process::exit(0);
    }
    let host_port = if let Ok(n) = args[1].parse::<u16>() {
        n
    } else {
        println!("Invalid port number");
        std::process::exit(0);
    };
    let main_pid = if let Ok(n) = args[2].parse::<u32>() {
        n
    } else {
        println!("Invalid main process id");
        std::process::exit(0);
    };
    // Relaunch as admin if not elevated
    if !is_elevated() {
        relaunch_with_elevation(host_port, main_pid, true);
    }
    // Setup the http server
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let make_svc = make_service_fn(|_conn| async {
        Ok::<_, Infallible>(service_fn(http_handler::handle_http))
    });
    let server = Server::bind(&addr).serve(make_svc);
    // Inform the main process of the port and pid of this sidecar
    let client = reqwest::Client::new();
    let res = client
        .post(format!(
            "http://127.0.0.1:{}/elevated_sidecar/init",
            host_port
        ))
        .body(
            serde_json::to_string(&ElevatedSidecarInitRequest {
                sidecar_port: server.local_addr().port(),
                sidecar_pid: std::process::id(),
            })
            .unwrap(),
        )
        .send()
        .await;
    if res.is_err() {
        println!("Could not inform main process of sidecar initialization");
        std::process::exit(0);
    }
    // Init NVML
    nvml::init();
    // Keep an eye on the main process and quit alongside it
    watch_main_process(main_pid);
    // Keep the HTTP server alive
    if let Err(e) = server.await {
        eprintln!("server error: {}", e);
    }
}

fn watch_main_process(main_pid: u32) {
    let pid = Pid::from_u32(main_pid);
    let mut s = System::new_all();
    std::thread::spawn(move || loop {
        s.refresh_processes();
        if s.process(pid).is_none() {
            println!("Main process has exited. Stopping elevated sidecar.");
            std::process::exit(0);
        }
        std::thread::sleep(Duration::from_secs(1));
    });
}
