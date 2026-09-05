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
use std::env;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, LazyLock, Mutex,
};
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, System};
use windows_sys::Win32::System::LibraryLoader::{
    SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_SYSTEM32,
};

mod afterburner;
mod cleanup;
mod gpu_power;
mod grpc;

static ERROR_REPORTING_ENABLED: LazyLock<Arc<AtomicBool>> =
    LazyLock::new(|| Arc::new(AtomicBool::new(false)));
static ERROR_REPORTING_GUARD: LazyLock<Mutex<Option<sentry::ClientInitGuard>>> =
    LazyLock::new(Default::default);

fn main() {
    // The runtime below is built by hand, so nothing loads a DLL before this narrows the search.
    let dll_search_restricted =
        unsafe { SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32) } != 0;
    init_logging();
    if !dll_search_restricted {
        error!("Could not restrict the DLL search path to System32");
    }
    let args: Vec<String> = env::args().collect();
    if let Some(parent_pid) = switch_value(&args, "cleanup-parent-pid") {
        let result = switch_string(&args, "cleanup-token")
            .ok_or_else(|| "missing cleanup token".to_string())
            .and_then(|token| cleanup::run_cleanup_helper(parent_pid, token));
        if let Err(e) = result {
            error!("Cleanup failed: {e}");
            std::process::exit(1);
        }
        std::process::exit(0);
    }
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(run());
}

async fn run() {
    let args: Vec<String> = env::args().collect();
    // Parse the arguments
    let host_port = match switch_value(&args, "core-grpc-port") {
        Some(n) => n,
        None => {
            error!("Missing or invalid arguments. Expected format:");
            error!("oyasumivr-elevated-sidecar.exe --core-grpc-port=<port> --core-pid=<pid>");
            std::process::exit(1);
        }
    };
    let main_pid = match switch_value(&args, "core-pid") {
        Some(n) => n,
        None => {
            error!("Missing or invalid --core-pid argument");
            std::process::exit(1);
        }
    };
    let error_reporting_enabled = args.iter().any(|arg| arg == "--error-reporting-enabled");
    if !is_elevated() {
        error!("Started without elevation. The core owns elevation, so there is nothing to retry.");
        std::process::exit(1);
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
                std::process::exit(1);
            }
        };
    let request = tonic::Request::new(ElevatedSidecarStartArgs {
        pid: std::process::id(),
        grpc_port: grpc_port as u32,
        grpc_web_port: grpc_web_port as u32,
    });
    // fatal on any error, including the core rejecting a sidecar it never asked for
    if let Err(e) = client.on_elevated_sidecar_start(request).await {
        error!("The core did not accept this sidecar: {e}");
        std::process::exit(1);
    }
    gpu_power::init();
    // Keep an eye on the main process and quit alongside it
    watch_main_process(main_pid).await;
}

fn init_logging() {
    let log_dir = if let Some(base_dirs) = BaseDirs::new() {
        base_dirs.data_local_dir().join("co.raphii.oyasumi/logs")
    } else {
        Path::new("co.raphii.oyasumi/logs").to_path_buf()
    };
    if let Err(e) = oyasumivr_shared::logging::init(&log_dir, "OyasumiVR_Elevated_Sidecar", true) {
        eprintln!("Could not initialize file logging: {e}");
    }
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

fn switch_string<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    let prefix = format!("--{name}=");
    args.iter()
        .find_map(|arg| arg.strip_prefix(prefix.as_str()))
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
