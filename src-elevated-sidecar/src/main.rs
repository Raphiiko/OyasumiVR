#![cfg_attr(
all(not(debug_assertions), target_os = "windows"),
windows_subsystem = "windows"
)]
#[macro_use(lazy_static)]
extern crate lazy_static;

use hyper::service::{make_service_fn, service_fn};
use hyper::Server;
use log::{error, info};
use oyasumi_shared::models::ElevatedSidecarInitRequest;
use std::convert::Infallible;
use std::env;
use std::fs::{
    // OpenOptions,
    File
};
use std::net::SocketAddr;
use std::path::Path;
use std::time::Duration;
use sysinfo::{Pid, PidExt, System, SystemExt};
use directories::BaseDirs;
use oyasumi_shared::windows::{is_elevated, relaunch_with_elevation};
use simplelog::{
    ColorChoice, CombinedLogger, Config, LevelFilter, TermLogger, TerminalMode, WriteLogger,
};

mod afterburner;
mod http_handler;
mod nvml;

#[tokio::main]
async fn main() {
    // Initialize logging
    let log_path = if let Some(base_dirs) = BaseDirs::new() {
        base_dirs
            .preference_dir()
            .join("co.raphii.oyasumi/logs/OyasumiSidecar.log")
    } else {
        Path::new("co.raphii.oyasumi/logs/OyasumiSidecar.log").to_path_buf()
    };
    CombinedLogger::init(vec![
        TermLogger::new(
            LevelFilter::Info,
            Config::default(),
            TerminalMode::Mixed,
            ColorChoice::Auto,
        ),
        WriteLogger::new(
            LevelFilter::Info,
            Config::default(),
            File::create(log_path).unwrap(),
            // OpenOptions::new()
            //     .create(true) 
            //     .append(true)
            //     .open(log_path)
            //     .unwrap(),
        ),
    ])
        .unwrap();
    // Get port of host http server from 1st argument
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        error!("Missing arguments. Expected format");
        error!("oyasumi-admin.exe [main-http-port] [main-process-id]");
        std::process::exit(0);
    }
    let host_port = if let Ok(n) = args[1].parse::<u16>() {
        n
    } else {
        error!("Invalid port number");
        std::process::exit(0);
    };
    let main_pid = if let Ok(n) = args[2].parse::<u32>() {
        n
    } else {
        error!("Invalid main process id");
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
            "http://127.0.0.1:{host_port}/elevated_sidecar/init"
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
        error!("Could not inform main process of sidecar initialization");
        std::process::exit(0);
    }
    // Init NVML
    nvml::init();
    // Keep an eye on the main process and quit alongside it
    watch_main_process(main_pid);
    // Keep the HTTP server alive
    if let Err(e) = server.await {
        error!("Server error: {}", e);
    }
}

fn watch_main_process(main_pid: u32) {
    let pid = Pid::from_u32(main_pid);
    let mut s = System::new_all();
    std::thread::spawn(move || loop {
        s.refresh_processes();
        if s.process(pid).is_none() {
            info!("Main process has exited. Stopping elevated sidecar.");
            std::process::exit(0);
        }
        std::thread::sleep(Duration::from_secs(1));
    });
}
