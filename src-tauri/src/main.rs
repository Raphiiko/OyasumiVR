#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

#[macro_use(lazy_static)]
extern crate lazy_static;

mod commands;
mod elevated_sidecar;
mod globals;
mod http_server;
mod image_cache;
mod lighthouse;
mod openvr;
mod os;
mod osc;
mod system_tray;
mod utils;
mod vrc_log_parser;

use cronjob::CronJob;
use globals::TAURI_APP_HANDLE;
use log::{info, LevelFilter};
use oyasumi_shared::windows::is_elevated;
use tauri::{plugin::TauriPlugin, Manager, Wry};
use tauri_plugin_log::{LogTarget, RotationStrategy};

fn main() {
    // Construct Oyasumi Tauri application
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs_extra::init())
        .plugin(configure_tauri_plugin_log())
        .plugin(configure_tauri_plugin_single_instance())
        .setup(|app| {
            match tauri::async_runtime::block_on(tauri::async_runtime::spawn(app_setup(
                app.handle(),
            ))) {
                Ok(_) => {}
                Err(e) => {
                    eprintln!("Error during Oyasumi's application setup: {e}");
                    std::process::exit(1);
                }
            }
            Ok(())
        })
        .system_tray(system_tray::init_system_tray())
        .on_system_tray_event(system_tray::handle_system_tray_events())
        .on_window_event(system_tray::handle_window_events())
        .invoke_handler(configure_command_handlers());
    // Run Oyasumi
    app.run(tauri::generate_context!())
        .expect("An error occurred while running the application");
}

fn configure_command_handlers() -> impl Fn(tauri::Invoke) {
    tauri::generate_handler![
        openvr::commands::openvr_get_devices,
        openvr::commands::openvr_status,
        openvr::commands::openvr_get_analog_gain,
        openvr::commands::openvr_set_analog_gain,
        openvr::commands::openvr_get_supersample_scale,
        openvr::commands::openvr_set_supersample_scale,
        os::commands::run_command,
        os::commands::play_sound,
        os::commands::show_in_folder,
        osc::commands::osc_send_bool,
        osc::commands::osc_send_float,
        osc::commands::osc_send_int,
        osc::commands::osc_valid_addr,
        osc::commands::start_osc_server,
        osc::commands::stop_osc_server,
        system_tray::commands::set_close_to_system_tray,
        system_tray::commands::set_start_in_system_tray,
        elevated_sidecar::commands::elevation_sidecar_running,
        elevated_sidecar::commands::start_elevation_sidecar,
        vrc_log_parser::commands::init_vrc_log_watcher,
        http_server::commands::get_http_server_port,
        image_cache::commands::clean_image_cache,
        lighthouse::commands::lighthouse_scan_devices,
        commands::log_utils::clean_log_files,
        commands::afterburner::msi_afterburner_set_profile,
        commands::notifications::xsoverlay_send_message,
        commands::splash::close_splashscreen,
        commands::nvml::nvml_status,
        commands::nvml::nvml_get_devices,
        commands::nvml::nvml_set_power_management_limit,
    ]
}

fn configure_tauri_plugin_log() -> TauriPlugin<Wry> {
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
        .build()
}

fn configure_tauri_plugin_single_instance() -> TauriPlugin<Wry> {
    tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        // Focus main  window when user attempts to launch a second instance.
        let window = app.get_window("main").unwrap();
        if let Ok(is_visible) = window.is_visible() {
            if is_visible {
                window.set_focus().unwrap();
            }
        }
    })
}

async fn app_setup(app_handle: tauri::AppHandle) {
    // Set up app reference
    *TAURI_APP_HANDLE.lock().await = Some(app_handle.clone());
    // Open devtools if we're in debug mode
    #[cfg(debug_assertions)]
    {
        let window = app_handle.get_window("main").unwrap();
        window.open_devtools();
    }
    // Get dependencies
    let cache_dir = app_handle.path_resolver().app_cache_dir().unwrap();
    // Initialize the system tray manager
    system_tray::init().await;
    // Initialize Image Cache
    image_cache::init(cache_dir).await;
    // Initialize OpenVR Manager
    openvr::init().await;
    // Initialize HTTP server
    http_server::init().await;
    // Load sounds
    os::load_sounds();
    // Initialize OSC
    osc::init().await;
    // Initialize Lighthouse Bluetooth
    lighthouse::init().await;
    // Initialize log commands
    commands::log_utils::init(app_handle.path_resolver().app_log_dir().unwrap()).await;
    // Setup start of minute cronjob
    let mut cron = CronJob::new("CRON_MINUTE_START", on_cron_minute_start);
    cron.seconds("0");
    CronJob::start_job_threaded(cron);
    // If we have admin privileges, prelaunch the elevation sidecar
    if is_elevated() {
        info!("[Core] Main process is running with elevation. Pre-launching sidecar...");
        // Wait for http server to start so we can poass the port
        loop {
            let main_http_port = http_server::PORT.lock().await;
            // Once we have the port, start the sidecar
            if main_http_port.is_some() {
                elevated_sidecar::start().await;
                break;
            }
        }
    } else {
        info!(
            "[Core] Main process is running without elevation. Sidecar will be launched on demand."
        );
    }
}

fn on_cron_minute_start(_: &str) {
    tauri::async_runtime::block_on(utils::send_event("CRON_MINUTE_START", ()));
}
