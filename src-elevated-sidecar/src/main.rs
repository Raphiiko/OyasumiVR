#![cfg_attr(
all(not(debug_assertions), target_os = "windows"),
windows_subsystem = "windows"
)]
#[macro_use(lazy_static)]
extern crate lazy_static;

use directories::BaseDirs;
use grpc::oyasumi_core::{oyasumi_core_client::OyasumiCoreClient, ElevatedSidecarStartArgs};
pub use grpc::oyasumi_elevated_sidecar as Models;
use log::{error, info};
use oyasumivr_shared::windows::is_elevated;
use simplelog::{
    ColorChoice, CombinedLogger, Config, LevelFilter, TermLogger, TerminalMode, WriteLogger,
};
use std::env;
use std::fs::File;
use std::path::Path;
use std::time::Duration;
use sysinfo::{Pid, PidExt, System, SystemExt};
use windows::relaunch_with_elevation;

mod afterburner;
mod grpc;
mod nvml;
mod windows;

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
    // Parse the arguments
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        error!("Missing arguments. Expected format");
        error!("oyasumivr-elevated-sidecar.exe [main-grpc-port] [main-process-id] [optional: old-process-id]");
        std::process::exit(0);
    }
    let host_port = if let Ok(n) = args[1].parse::<u32>() {
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
    let old_process_id = if args.len() > 3 {
        if let Ok(n) = args[3].parse::<u32>() {
            Some(n)
        } else {
            error!("Invalid old process id");
            std::process::exit(0);
        }
    } else {
        None
    };
    // Relaunch as admin if not elevated
    if !is_elevated() {
        relaunch_with_elevation(host_port, main_pid, true);
    }
    // Setup the grpc server
    let port = grpc::init().await;
    // Inform the main process of the sidecar start
    let mut client =
        match OyasumiCoreClient::connect(format!("http://127.0.0.1:{}", host_port)).await {
            Ok(client) => client,
            Err(e) => {
                error!("Could not connect to main process: {}", e);
                std::process::exit(0);
            }
        };
    let request = tonic::Request::new(ElevatedSidecarStartArgs {
        pid: std::process::id(),
        port: port as u32,
        old_pid: old_process_id,
    });
    let response = client.on_elevated_sidecar_start(request).await;
    if response.is_err() {
        error!("Could not inform main process of sidecar initialization");
        std::process::exit(0);
    }
    // Init NVML
    nvml::init();
    // Keep an eye on the main process and quit alongside it
    watch_main_process(main_pid).await;
}

async fn watch_main_process(main_pid: u32) {
    let pid = Pid::from_u32(main_pid);
    let mut s = System::new_all();
    loop {
        s.refresh_processes();
        if s.process(pid).is_none() {
            info!("Main process has exited. Stopping elevated sidecar.");
            std::process::exit(0);
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}
