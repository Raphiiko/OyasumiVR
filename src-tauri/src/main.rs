#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
#![feature(io_error_more)]

#[macro_use(lazy_static)]
extern crate lazy_static;

use cronjob::CronJob;
use nvml_wrapper::Nvml;
use tauri::Manager;
use std::net::UdpSocket;
use std::sync::Mutex;
use tauri_plugin_store::PluginBuilder;

mod commands {
    pub mod nvml;
    pub mod openvr;
    pub mod os;
    pub mod osc;
    pub mod splash;
    pub mod windows;
}
mod background;
mod models;

lazy_static! {
    static ref OVR_CONTEXT: Mutex<Option<openvr::Context>> = Default::default();
    static ref TAURI_WINDOW: Mutex<Option<tauri::Window>> = Default::default();
    static ref OVR_STATUS: Mutex<String> = Mutex::new(String::from("INITIALIZING"));
    static ref NVML_STATUS: Mutex<String> = Mutex::new(String::from("INITIALIZING"));
    static ref NVML_HANDLE: Mutex<Option<Nvml>> = Default::default();
    static ref OSC_SOCKET: Mutex<Option<UdpSocket>> = Default::default();
}

fn main() {
    tauri::Builder::default()
        .plugin(PluginBuilder::default().build())
        .setup(|app| {
            // Set up window reference
            let window = app.get_window("main").unwrap();
            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                window.open_devtools();
            }
            *TAURI_WINDOW.lock().unwrap() = Some(window);
            std::thread::spawn(|| -> () {
                // Initialize OpenVR
                println!("Initializing OpenVR");
                let ovr_context = match unsafe { openvr::init(openvr::ApplicationType::Overlay) } {
                    Ok(ctx) => {
                        println!("Initialized OpenVR");
                        Some(ctx)
                    }
                    Err(err) => {
                        println!("Failed to initialize openvr: {}", err);
                        *OVR_STATUS.lock().unwrap() = String::from("INIT_FAILED");
                        let window_guard = TAURI_WINDOW.lock().unwrap();
                        let window = window_guard.as_ref().unwrap();
                        let _ = window.emit_all("OVR_INIT_FAILED", ());
                        None
                    }
                };
                // Spawn event handling thread
                *OVR_CONTEXT.lock().unwrap() = ovr_context;
                let context_guard = OVR_CONTEXT.lock().unwrap();
                let ovr_context = context_guard.as_ref();
                if let Some(_) = ovr_context {
                    background::spawn_openvr_background_thread();
                }
                // Inform frontend of completion
                *OVR_STATUS.lock().unwrap() = String::from("INIT_COMPLETE");
                let window_guard = TAURI_WINDOW.lock().unwrap();
                let window = window_guard.as_ref().unwrap();
                let _ = window.emit_all("OVR_INIT_COMPLETE", ());
                // Initialize NVML
                match Nvml::init() {
                    Ok(nvml) => {
                        *NVML_HANDLE.lock().unwrap() = Some(nvml);
                        *NVML_STATUS.lock().unwrap() = String::from("INIT_COMPLETE");
                        let _ = window.emit_all("NVML_INIT_COMPLETE", ());
                        ()
                    }
                    Err(err) => {
                        *NVML_HANDLE.lock().unwrap() = None;
                        match err {
                            nvml_wrapper::error::NvmlError::DriverNotLoaded => {
                                *NVML_STATUS.lock().unwrap() = String::from("DRIVER_NOT_LOADED");
                            }
                            nvml_wrapper::error::NvmlError::NoPermission => {
                                *NVML_STATUS.lock().unwrap() = String::from("NO_PERMISSION");
                            }
                            nvml_wrapper::error::NvmlError::Unknown => {
                                *NVML_STATUS.lock().unwrap() = String::from("NVML_UNKNOWN_ERROR");
                            }
                            _ => {
                                *NVML_STATUS.lock().unwrap() = String::from("UNKNOWN_ERROR");
                            }
                        };
                        let _ = window.emit_all("NVML_INIT_ERROR", ());
                    }
                };
            });
            // Setup start of minute cronjob
            let mut cron = CronJob::new("CRON_MINUTE_START", on_cron_minute_start);
            cron.seconds("0");
            CronJob::start_job_threaded(cron);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::openvr::openvr_get_devices,
            commands::openvr::openvr_status,
            commands::os::run_command,
            commands::splash::close_splashscreen,
            commands::nvml::nvml_status,
            commands::nvml::nvml_get_devices,
            commands::nvml::nvml_set_power_management_limit,
            commands::windows::windows_is_elevated,
            commands::windows::windows_relaunch_with_elevation,
            commands::osc::osc_send_bool,
            commands::osc::osc_send_float,
            commands::osc::osc_send_int,
            commands::osc::osc_init,
            commands::osc::osc_valid_addr,
        ])
        .run(tauri::generate_context!())
        .expect("An error occurred while running the application");
}

fn on_cron_minute_start(_: &str) {
    let window_guard = TAURI_WINDOW.lock().unwrap();
    let window = window_guard.as_ref().unwrap();
    let _ = window.emit_all("CRON_MINUTE_START", ());
}
