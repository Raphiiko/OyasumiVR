#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

#[macro_use(lazy_static)]
extern crate lazy_static;

use crate::image_cache::ImageCache;
use cronjob::CronJob;
use log::{error, info, LevelFilter};
use std::{net::UdpSocket, sync::Mutex};
use tauri::{api::dialog::blocking::MessageDialogBuilder, Manager};
use tauri_plugin_fs_extra::FsExtra;
use tauri_plugin_log::{LogTarget, LoggerBuilder, RotationStrategy};
use tauri_plugin_store::PluginBuilder;

mod commands {
    pub mod admin;
    pub mod afterburner;
    pub mod http;
    pub mod log_parser;
    pub mod nvml;
    pub mod openvr;
    pub mod os;
    pub mod osc;
    pub mod splash;
}
mod background {
    pub mod http_server;
    pub mod log_parser;
    pub mod openvr;
    pub mod osc;
}
mod elevated_sidecar;
mod image_cache;

lazy_static! {
    static ref OVR_CONTEXT: Mutex<Option<openvr::Context>> = Default::default();
    static ref TAURI_WINDOW: Mutex<Option<tauri::Window>> = Default::default();
    static ref OVR_STATUS: Mutex<String> = Mutex::new(String::from("INITIALIZING"));
    static ref OSC_SEND_SOCKET: Mutex<Option<UdpSocket>> = Default::default();
    static ref OSC_RECEIVE_SOCKET: Mutex<Option<UdpSocket>> = Default::default();
    static ref MAIN_HTTP_SERVER_PORT: Mutex<Option<u16>> = Default::default();
    static ref SIDECAR_HTTP_SERVER_PORT: Mutex<Option<u16>> = Default::default();
    static ref SIDECAR_PID: Mutex<Option<u32>> = Default::default();
    static ref IMAGE_CACHE: Mutex<Option<ImageCache>> = Default::default();
}

fn main() {
    tauri::Builder::default()
        .plugin(PluginBuilder::default().build())
        .plugin(FsExtra::default())
        .plugin(
            LoggerBuilder::default()
                .format(move |out, message, record| {
                    let format = time::format_description::parse(
                        "[[[year]-[month]-[day]][[[hour]:[minute]:[second]]",
                    )
                    .unwrap();
                    out.finish(format_args!(
                        "{}[{}] {}",
                        time::OffsetDateTime::now_utc().format(&format).unwrap(),
                        record.level(),
                        message
                    ))
                })
                .level(LevelFilter::Info)
                .targets([LogTarget::LogDir, LogTarget::Stdout, LogTarget::Webview])
                .rotation_strategy(RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Focus main window when user attempts to launch a second instance.
            let window = app.get_window("main").unwrap();
            if let Some(is_visible) = window.is_visible().ok() {
                if is_visible {
                    window.set_focus().unwrap();
                }
            }
        }))
        .setup(|app| {
            // Set up window reference
            let window = app.get_window("main").unwrap();
            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                window.open_devtools();
            }
            *TAURI_WINDOW.lock().unwrap() = Some(window);
            // Get dependencies
            let cache_dir = app.path_resolver().app_cache_dir().unwrap().clone();
            let app_handle = app.handle();
            std::thread::spawn(move || -> () {
                // Initialize Image Cache
                let image_cache_dir = cache_dir.join("image_cache");
                let image_cache = ImageCache::new(image_cache_dir.into_os_string().clone());
                image_cache.clean(true);
                *IMAGE_CACHE.lock().unwrap() = Some(image_cache);
                // Initialize OpenVR
                info!("[Core] Initializing OpenVR");
                let ovr_context = match unsafe { openvr::init(openvr::ApplicationType::Overlay) } {
                    Ok(ctx) => Some(ctx),
                    Err(err) => {
                        error!("[Core] Failed to initialize OpenVR: {}", err);
                        *OVR_STATUS.lock().unwrap() = String::from("INIT_FAILED");
                        let window_guard = TAURI_WINDOW.lock().unwrap();
                        let window = window_guard.as_ref().unwrap();
                        let _ = window.emit_all("OVR_INIT_FAILED", ());
                        MessageDialogBuilder::new("Oyasumi", "Could not connect to SteamVR. Please make sure SteamVR is installed before launching Oyasumi.").show();
                        app_handle.exit(1);
                        None
                    }
                };
                *OVR_CONTEXT.lock().unwrap() = ovr_context;
                let context_guard = OVR_CONTEXT.lock().unwrap();
                let ovr_context = context_guard.as_ref();
                if let Some(_) = ovr_context {
                    // Spawn event handling thread
                    background::openvr::spawn_openvr_background_thread();
                    // Inform frontend of completion
                    info!("[Core] OpenVR initialization complete");
                    *OVR_STATUS.lock().unwrap() = String::from("INIT_COMPLETE");
                    let window_guard = TAURI_WINDOW.lock().unwrap();
                    let window = window_guard.as_ref().unwrap();
                    let _ = window.emit_all("OVR_INIT_COMPLETE", ());
                }
                // Spawn HTTP server thread
                background::http_server::spawn_http_server_thread();
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
            commands::osc::osc_send_bool,
            commands::osc::osc_send_float,
            commands::osc::osc_send_int,
            commands::osc::osc_init,
            commands::osc::osc_valid_addr,
            commands::admin::elevation_sidecar_running,
            commands::admin::start_elevation_sidecar,
            commands::log_parser::init_vrc_log_watcher,
            commands::http::get_http_server_port,
            commands::afterburner::msi_afterburner_set_profile,
        ])
        .run(tauri::generate_context!())
        .expect("An error occurred while running the application");
}

fn on_cron_minute_start(_: &str) {
    let window_guard = TAURI_WINDOW.lock().unwrap();
    let window = window_guard.as_ref().unwrap();
    let _ = window.emit_all("CRON_MINUTE_START", ());
}
