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
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, LazyLock, Mutex,
};
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, System};
use windows::relaunch_with_elevation;
use windows_sys::Win32::System::LibraryLoader::{
    SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_SYSTEM32,
};

mod afterburner;
mod grpc;
mod nvml;
mod windows;

static ERROR_REPORTING_ENABLED: LazyLock<Arc<AtomicBool>> =
    LazyLock::new(|| Arc::new(AtomicBool::new(false)));
static ERROR_REPORTING_GUARD: LazyLock<Mutex<Option<sentry::ClientInitGuard>>> =
    LazyLock::new(Default::default);

#[tokio::main]
async fn main() {
    // before any DLL this process loads later, prefer System32 over our own directory
    let dll_search_restricted =
        unsafe { SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32) } != 0;
    // Initialize logging
    let log_path = if let Some(base_dirs) = BaseDirs::new() {
        base_dirs
            .data_local_dir()
            .join("co.raphii.oyasumi/logs/OyasumiVR_Elevated_Sidecar.log")
    } else {
        Path::new("co.raphii.oyasumi/logs/OyasumiVR_Elevated_Sidecar.log").to_path_buf()
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
    if !dll_search_restricted {
        error!("Could not restrict the DLL search path to System32");
    }
    // Parse the arguments
    let args: Vec<String> = env::args().collect();
    let host_port = match switch_value(&args, "core-grpc-port") {
        Some(n) => n,
        None => {
            error!("Missing or invalid arguments. Expected format:");
            error!("oyasumivr-elevated-sidecar.exe --core-grpc-port=<port> --core-pid=<pid> [--old-pid=<pid>]");
            std::process::exit(0);
        }
    };
    let main_pid = match switch_value(&args, "core-pid") {
        Some(n) => n,
        None => {
            error!("Missing or invalid --core-pid argument");
            std::process::exit(0);
        }
    };
    let old_process_id = switch_value(&args, "old-pid");
    let error_reporting_enabled = args.iter().any(|arg| arg == "--error-reporting-enabled");
    // Relaunch as admin if not elevated
    if !is_elevated() {
        relaunch_with_elevation(host_port, main_pid, error_reporting_enabled, true);
        return;
    }
    set_error_reporting_enabled(error_reporting_enabled);
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
    // Init NVML
    nvml::init();
    // Keep an eye on the main process and quit alongside it
    watch_main_process(main_pid).await;
}

pub fn set_error_reporting_enabled(enabled: bool) {
    let enabled = enabled && !cfg!(debug_assertions);
    if !enabled {
        ERROR_REPORTING_ENABLED.store(false, Ordering::Relaxed);
        return;
    }
    let Ok(mut guard) = ERROR_REPORTING_GUARD.lock() else {
        ERROR_REPORTING_ENABLED.store(false, Ordering::Relaxed);
        return;
    };
    if guard.is_some() {
        ERROR_REPORTING_ENABLED.store(true, Ordering::Relaxed);
        return;
    }
    let data_dir = BaseDirs::new()
        .map(|dirs| dirs.data_local_dir().join("co.raphii.oyasumi"))
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    *guard = Some(oyasumivr_shared::error_reporting::init(
        "elevated",
        env!("CARGO_PKG_VERSION"),
        Arc::new(oyasumivr_shared::error_reporting::EventBudget::new(
            data_dir.join("error-reporting-elevated.json"),
            oyasumivr_shared::error_reporting::EventBudgetConfig {
                first_event_cap: 10,
                recurrence_cap: 5,
                issue_cap: 3,
                recurrence_sample_rate: 0.1,
            },
        )),
        ERROR_REPORTING_ENABLED.clone(),
    ));
    ERROR_REPORTING_ENABLED.store(true, Ordering::Relaxed);
}

fn switch_value(args: &[String], name: &str) -> Option<u32> {
    let prefix = format!("--{name}=");
    args.iter()
        .find_map(|arg| arg.strip_prefix(prefix.as_str())?.parse::<u32>().ok())
}

async fn watch_main_process(main_pid: u32) {
    let pid = Pid::from(main_pid as usize);
    let mut s = System::new_all();
    let mut missed_polls = 0;
    loop {
        s.refresh_processes(ProcessesToUpdate::All, true);
        if s.process(pid).is_none() {
            missed_polls += 1;
            if missed_polls >= 3 {
                info!("Main process has exited. Stopping elevated sidecar.");
                std::process::exit(0);
            }
        } else {
            missed_polls = 0;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}
