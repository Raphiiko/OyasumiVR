// #![cfg_attr(
//     all(not(debug_assertions), target_os = "windows"),
//     windows_subsystem = "windows"
// )]
#[cfg(not(target_os = "windows"))]
compile_error!("oyasumivr-elevated-sidecar only supports Windows.");

#[macro_use(lazy_static)]
extern crate lazy_static;

use directories::BaseDirs;
use grpc::oyasumi_core::{oyasumi_core_client::OyasumiCoreClient, ElevatedSidecarStartArgs};
pub use grpc::oyasumi_elevated_sidecar as Models;
use log::{error, info};
use oyasumivr_shared::windows::is_elevated;
use simplelog::{
    ColorChoice, CombinedLogger, Config, LevelFilter, SharedLogger, TermLogger, TerminalMode,
    WriteLogger,
};
use std::env;
use std::fs::{self, File};
use std::path::Path;
use std::panic;
use windows::relaunch_with_elevation;

mod afterburner;
mod adlx_backend;
mod gpu_power;
mod grpc;
mod nvml;
mod nvml_backend;
mod windows;

#[tokio::main]
async fn main() {
    panic::set_hook(Box::new(|panic_info| {
        error!("[PANIC] Elevated sidecar panicked: {panic_info}");
    }));
    // Initialize logging
    let log_path = if let Some(base_dirs) = BaseDirs::new() {
        base_dirs
            .data_local_dir()
            .join("co.raphii.oyasumi/logs/OyasumiVR_Elevated_Sidecar.log")
    } else {
        Path::new("co.raphii.oyasumi/logs/OyasumiVR_Elevated_Sidecar.log").to_path_buf()
    };
    let mut loggers: Vec<Box<dyn SharedLogger>> = vec![TermLogger::new(
        LevelFilter::Info,
        Config::default(),
        TerminalMode::Mixed,
        ColorChoice::Auto,
    )];
    if let Some(log_dir) = log_path.parent() {
        if let Err(e) = fs::create_dir_all(log_dir) {
            eprintln!(
                "Failed to create elevated sidecar log directory at {:?}: {}",
                log_dir, e
            );
        }
    }
    match File::create(&log_path) {
        Ok(log_file) => loggers.push(WriteLogger::new(
            LevelFilter::Info,
            Config::default(),
            log_file,
        )),
        Err(e) => {
            eprintln!(
                "Failed to create elevated sidecar log file at {:?}: {}",
                log_path, e
            );
        }
    }
    CombinedLogger::init(loggers).unwrap();
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
        if !relaunch_with_elevation(host_port, main_pid, true) {
            error!("Failed to request administrative privileges for elevated sidecar.");
            std::process::exit(1);
        }
        return;
    }
    // Setup the grpc server
    let grpc_port = grpc::init_server().await;
    let grpc_web_port = grpc::init_web_server().await;
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
        grpc_port: grpc_port as u32,
        grpc_web_port: grpc_web_port as u32,
        old_pid: old_process_id,
    });
    let response = client.on_elevated_sidecar_start(request).await;
    if response.is_err() {
        error!("Could not inform main process of sidecar initialization");
        std::process::exit(0);
    }
    // Initialize the shared GPU power backend layer.
    let gpu_power_initialized = gpu_power::init();
    info!(
        "[GPU] Power-limit backend initialization finished (initialized={})",
        gpu_power_initialized
    );
    // Keep an eye on the main process and quit alongside it
    watch_main_process(main_pid).await;
}

async fn watch_main_process(main_pid: u32) {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_FAILED, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_SYNCHRONIZE, WAIT_OBJECT_0,
    };

    info!("[Core] Watching main process (pid={})", main_pid);
    let process_handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            main_pid,
        )
    };
    if process_handle == 0 {
        error!(
            "Could not open handle for main process (pid={}). Stopping elevated sidecar.",
            main_pid
        );
        std::process::exit(0);
    }

    loop {
        let wait_result = unsafe { WaitForSingleObject(process_handle, 1000) };
        match wait_result {
            WAIT_TIMEOUT => {}
            WAIT_OBJECT_0 => {
                info!("Main process has exited. Stopping elevated sidecar.");
                unsafe {
                    CloseHandle(process_handle);
                }
                std::process::exit(0);
            }
            WAIT_FAILED => {
                error!(
                    "Failed while waiting for main process (pid={}). Stopping elevated sidecar.",
                    main_pid
                );
                unsafe {
                    CloseHandle(process_handle);
                }
                std::process::exit(0);
            }
            other => {
                error!(
                    "Unexpected wait result while watching main process (pid={}): {}",
                    main_pid, other
                );
                unsafe {
                    CloseHandle(process_handle);
                }
                std::process::exit(0);
            }
        }
    }
}

