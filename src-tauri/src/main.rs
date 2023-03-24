#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

#[macro_use(lazy_static)]
extern crate lazy_static;

use crate::commands::admin::start_elevation_sidecar;
use crate::image_cache::ImageCache;
use background::openvr::OpenVRManager;
use cronjob::CronJob;
use log::{info, LevelFilter};
use oyasumi_shared::windows::is_elevated;
use std::{net::UdpSocket, sync::Mutex};
use tauri::{Manager, SystemTray, SystemTrayEvent};
use tauri_plugin_log::{LogTarget, RotationStrategy};

mod commands {
    pub mod admin;
    pub mod afterburner;
    pub mod http;
    pub mod log_parser;
    pub mod notifications;
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
mod gesture_detector;
mod image_cache;
mod sleep_detector;
mod utils;

lazy_static! {
    static ref OPENVR_MANAGER: Mutex<Option<OpenVRManager>> = Default::default();
    static ref TAURI_WINDOW: Mutex<Option<tauri::Window>> = Default::default();
    static ref OSC_SEND_SOCKET: Mutex<Option<UdpSocket>> = Default::default();
    static ref OSC_RECEIVE_SOCKET: Mutex<Option<UdpSocket>> = Default::default();
    static ref MAIN_HTTP_SERVER_PORT: Mutex<Option<u16>> = Default::default();
    static ref SIDECAR_HTTP_SERVER_PORT: Mutex<Option<u16>> = Default::default();
    static ref SIDECAR_PID: Mutex<Option<u32>> = Default::default();
    static ref IMAGE_CACHE: Mutex<Option<ImageCache>> = Default::default();
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs_extra::init())
        .plugin(
            tauri_plugin_log::Builder::default()
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
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                event.window().hide().unwrap();
                api.prevent_close();
            }
            _ => {}
        })
        .system_tray(
            SystemTray::new()
        )
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick {
              position: _,
              size: _,
              ..
            } => {
              let window = app.get_window("main").unwrap();
              window.show().unwrap();
              window.set_focus().unwrap();
            }
            _ => (),
        })
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
            std::thread::spawn(move || -> () {
                // Initialize Image Cache
                let image_cache_dir = cache_dir.join("image_cache");
                let image_cache = ImageCache::new(image_cache_dir.into_os_string().clone());
                image_cache.clean(true);
                *IMAGE_CACHE.lock().unwrap() = Some(image_cache);
                // Initialize OpenVR Manager
                let openvr_manager = OpenVRManager::new();
                openvr_manager.set_active(true);
                *OPENVR_MANAGER.lock().unwrap() = Some(openvr_manager);
                // Spawn HTTP server thread
                background::http_server::spawn_http_server_thread();
                // Load sounds
                commands::os::load_sounds();
            });
            // Setup start of minute cronjob
            let mut cron = CronJob::new("CRON_MINUTE_START", on_cron_minute_start);
            cron.seconds("0");
            CronJob::start_job_threaded(cron);
            // If we have admin privileges, prelaunch the elevation sidecar
            if is_elevated() {
                info!("[Core] Main process is running with elevation. Pre-launching sidecar...");
                loop {
                    {
                        let main_http_port = MAIN_HTTP_SERVER_PORT.lock().unwrap();
                        if main_http_port.is_some() {
                            start_elevation_sidecar();
                            break;
                        }
                    }
                }
            } else {
                info!("[Core] Main process is running without elevation. Sidecar will be launched on demand.");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::openvr::openvr_get_devices,
            commands::openvr::openvr_status,
            commands::openvr::openvr_get_analog_gain,
            commands::openvr::openvr_set_analog_gain,
            commands::os::run_command,
            commands::os::play_sound,
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
            commands::notifications::xsoverlay_send_message,
        ]);

    app.run(tauri::generate_context!())
        .expect("An error occurred while running the application");
}

fn on_cron_minute_start(_: &str) {
    let window_guard = TAURI_WINDOW.lock().unwrap();
    let window = window_guard.as_ref().unwrap();
    let _ = window.emit_all("CRON_MINUTE_START", ());
}
