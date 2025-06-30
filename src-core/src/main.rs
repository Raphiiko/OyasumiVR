#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod discord;
mod elevated_sidecar;
mod flavour;
mod globals;
mod grpc;
mod hardware;
mod http;
mod image_cache;
mod lighthouse;
mod migrations;
mod openvr;
mod os;
mod osc;
mod overlay_sidecar;
mod steam;
mod system_tray;
mod telemetry;
mod utils;
mod vrc_log_parser;

use std::{mem, sync::atomic::Ordering};

use config::Config;
pub use flavour::BUILD_FLAVOUR;
pub use grpc::models as Models;

use cronjob::CronJob;
use globals::{APTABASE_APP_KEY, FLAGS, TAURI_APP_HANDLE};
use log::{info, warn, LevelFilter};
use oyasumivr_shared::windows::is_elevated;
use serde_json::json;
use tauri::{plugin::TauriPlugin, Manager, Wry};
use tauri_plugin_cli::CliExt;
use tauri_plugin_log::RotationStrategy;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings6;

use crate::globals::APTABASE_HOST;

#[tokio::main]
async fn main() {
    // Attach to parent console if we're running from a command line
    #[cfg(windows)]
    {
        use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
        let _ = unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };
    }
    // Construct OyasumiVR Tauri application
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(configure_tauri_plugin_single_instance())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(configure_tauri_plugin_log())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(configure_tauri_plugin_aptabase())
        .setup(|app| {
            let matches = match app.cli().matches() {
                Ok(matches) => Some(matches),
                Err(e) => {
                    eprintln!("Error parsing command line arguments: {e}");
                    app.handle().exit(1);
                    None
                }
            };
            futures::executor::block_on(async {
                *globals::TAURI_CLI_MATCHES.lock().await = matches;
            });
            match futures::executor::block_on(tauri::async_runtime::spawn(app_setup(
                app.handle().clone(),
            ))) {
                Ok(_) => {}
                Err(e) => {
                    eprintln!("Error during Oyasumi's application setup: {e}");
                    app.handle().exit(1);
                }
            }
            Ok(())
        })
        .invoke_handler(configure_command_handlers())
        .on_window_event(system_tray::handle_window_events)
        .run(tauri::generate_context!())
        .expect("An error occurred while running the application")
}

fn configure_tauri_plugin_single_instance() -> TauriPlugin<Wry> {
    tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        // Focus main window when user attempts to launch a second instance.
        let window = app.get_webview_window("main").unwrap();
        if let Ok(is_visible) = window.is_visible() {
            // Window is minimized to tray, show it
            if !is_visible {
                window.show().unwrap();
            }
            // Focus the window
            window.set_focus().unwrap();
        }
    })
}

fn configure_tauri_plugin_aptabase() -> TauriPlugin<Wry> {
    tauri_plugin_aptabase::Builder::new(APTABASE_APP_KEY)
        .with_options(tauri_plugin_aptabase::InitOptions {
            #[allow(clippy::const_is_empty)]
            host: if APTABASE_HOST.is_empty() {
                None
            } else {
                Some(APTABASE_HOST.to_string())
            },
            flush_interval: tauri_plugin_aptabase::InitOptions::default().flush_interval,
        })
        .with_panic_hook(Box::new(|client, info, msg| {
            let location = info
                .location()
                .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
                .unwrap_or_default();

            // Upload crash report if telemetry is enabled
            if telemetry::TELEMETRY_ENABLED.load(Ordering::Relaxed) {
                println!("Uploading panic data to Aptabase: {} ({})", msg, location);
                let _ = client.track_event(
                    "rust_panic",
                    Some(json!({
                      "info": format!("{} ({})", msg, location),
                    })),
                );
            }

            // Write msg and location to file
            let panic_log_path = {
                let full_path = std::env::current_exe().unwrap();
                full_path.parent().unwrap().to_path_buf().join("panic.log")
            };
            println!("Writing panic log to {:#?}", panic_log_path);
            let _ = std::fs::write(panic_log_path, format!("{} ({})\n", msg, location));
        }))
        .build()
}

fn configure_tauri_plugin_log() -> TauriPlugin<Wry> {
    let mut builder = tauri_plugin_log::Builder::new()
        .clear_targets()
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
        .rotation_strategy(RotationStrategy::KeepAll);

    builder = builder
        .level(LevelFilter::Info)
        .target(tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::Stdout,
        ))
        .target(tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::LogDir { file_name: None },
        ));

    #[cfg(debug_assertions)]
    {
        builder = builder
            .target(tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Webview,
            ))
            .level(LevelFilter::Debug);
    }

    builder.build()
}

async fn app_setup(app_handle: tauri::AppHandle) {
    // Process elevation security args
    os::elevation::process_elevation_cli_args().await;

    info!(
        "[Core] Starting OyasumiVR in {} mode",
        crate::utils::cli_core_mode().await
    );
    // Ensure the working directory is the installation directory
    let executable_path = {
        let full_path = std::env::current_exe().unwrap();
        full_path.parent().unwrap().to_path_buf()
    };
    info!("[Core] Setting working directory to: {:?}", executable_path);
    std::env::set_current_dir(&executable_path).unwrap();
    // Clean up old batch files from previous runs
    os::cleanup_batch_files().await;
    // Run any migrations first
    migrations::run_migrations().await;
    // Load configs
    load_configs().await;
    // Set up app reference
    *TAURI_APP_HANDLE.lock().await = Some(app_handle.clone());
    let window = app_handle.get_webview_window("main").unwrap();
    // Open devtools if we're in debug mode
    #[cfg(debug_assertions)]
    {
        window.open_devtools();
    }
    // Disable swipe navigation in main window
    window
        .with_webview(|webview| unsafe {
            let settings = webview
                .controller()
                .CoreWebView2()
                .unwrap()
                .Settings()
                .unwrap();
            let settings: ICoreWebView2Settings6 = mem::transmute(settings);
            settings.SetIsSwipeNavigationEnabled(false).unwrap();
        })
        .unwrap();
    // Get dependencies
    let cache_dir = app_handle.path().app_cache_dir().unwrap();
    // Initialize utility module
    utils::init();
    // Initialize Steam module
    steam::init().await;
    // Initialize HTTP server
    http::init().await;
    // Initialize gRPC server
    grpc::init_server().await;
    grpc::init_web_server().await;
    // Initialize OSC
    osc::init().await;
    // Initialize OpenVR Manager
    openvr::init().await;
    // Initialize Image Cache
    image_cache::init(cache_dir).await;
    // Init sound playback
    os::init_sound_playback().await;
    // Initialize audio device manager
    os::init_audio_device_manager().await;
    // Initialize Lighthouse Bluetooth
    lighthouse::init().await;
    // Initialize Hardware modules
    hardware::init().await;
    // Initialize log commands
    commands::log_utils::init(app_handle.path().app_log_dir().unwrap()).await;
    // Initialize elevated sidecar module
    elevated_sidecar::init().await;
    // Initialize overlay sidecar module
    overlay_sidecar::init().await;
    // Initialize Discord module
    discord::init().await;
    // Initialize system tray
    system_tray::init().await;
    // Setup start of minute cronjob
    let mut cron = CronJob::new("CRON_MINUTE_START", on_cron_minute_start);
    cron.seconds("0");
    CronJob::start_job_threaded(cron);
    // If we have admin privileges, prelaunch the elevation sidecar
    if is_elevated() {
        info!("[Core] Main process is running with elevation. Pre-launching elevated sidecar...");
        // Wait for grpc server to start so we can pass the port
        loop {
            let core_grpc_port = grpc::SERVER_PORT.lock().await;
            // Once we have the port, start the sidecar
            if core_grpc_port.is_some() {
                drop(core_grpc_port);
                elevated_sidecar::commands::start_elevated_sidecar().await;
                break;
            }
        }
    } else {
        info!(
            "[Core] Main process is running without elevation. Elevated sidecar will be launched on demand."
        );
    }

    // Start profiling if we're in debug mode
    #[cfg(debug_assertions)]
    {
        utils::profiling::enable_profiling();
    }
    // Start profiling if the flag for it is set
    #[cfg(not(debug_assertions))]
    if globals::is_flag_set("ENABLE_PROFILING").await {
        utils::profiling::enable_profiling();
    }
}

async fn load_configs() {
    match Config::builder()
        .add_source(config::File::with_name("flags"))
        .build()
    {
        Ok(flags) => {
            *FLAGS.lock().await = Some(flags);
        }
        Err(e) => match e {
            config::ConfigError::NotFound(_) => {
                warn!("[Core] Could not find flags config. Using default values.");
            }
            _ => {
                warn!("[Core] Could not load flags config: {:#?}", e);
            }
        },
    };
}

fn on_cron_minute_start(_: &str) {
    futures::executor::block_on(utils::send_event("CRON_MINUTE_START", ()));
}

fn configure_command_handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
    tauri::generate_handler![
        openvr::commands::openvr_get_devices,
        openvr::commands::openvr_status,
        openvr::commands::openvr_get_analog_gain,
        openvr::commands::openvr_set_analog_gain,
        openvr::commands::openvr_get_supersample_scale,
        openvr::commands::openvr_set_supersample_scale,
        openvr::commands::openvr_get_fade_distance,
        openvr::commands::openvr_set_fade_distance,
        openvr::commands::openvr_set_image_brightness,
        openvr::commands::openvr_launch_binding_configuration,
        openvr::commands::openvr_get_binding_origins,
        openvr::commands::openvr_is_dashboard_visible,
        openvr::commands::openvr_reregister_manifest,
        openvr::commands::openvr_set_init_delay_fix,
        openvr::commands::openvr_set_analog_color_temp,
        openvr::commands::openvr_set_app_framelimit,
        openvr::commands::openvr_get_app_framelimit,
        hardware::beyond::commands::bigscreen_beyond_is_connected,
        hardware::beyond::commands::bigscreen_beyond_set_brightness,
        hardware::beyond::commands::bigscreen_beyond_set_led_color,
        hardware::beyond::commands::bigscreen_beyond_set_fan_speed,
        hardware::beyond::commands::bigscreen_beyond_get_saved_preferences,
        os::commands::run_command,
        os::commands::run_cmd_commands,
        os::commands::play_sound,
        os::commands::show_in_folder,
        os::commands::quit_steamvr,
        os::commands::get_windows_power_policies,
        os::commands::set_windows_power_policy,
        os::commands::active_windows_power_policy,
        os::commands::windows_shutdown,
        os::commands::windows_reboot,
        os::commands::windows_sleep,
        os::commands::windows_logout,
        os::commands::windows_hibernate,
        os::commands::windows_is_elevated,
        os::commands::get_audio_devices,
        os::commands::set_audio_device_volume,
        os::commands::set_audio_device_mute,
        os::commands::set_mic_activity_device_id,
        os::commands::set_hardware_mic_activity_enabled,
        os::commands::set_hardware_mic_activivation_threshold,
        os::commands::is_vrchat_active,
        os::commands::is_elevation_security_disabled,
        osc::commands::osc_send_command,
        osc::commands::osc_valid_addr,
        osc::commands::start_osc_server,
        osc::commands::stop_osc_server,
        osc::commands::get_vrchat_osc_address,
        osc::commands::get_vrchat_oscquery_address,
        osc::commands::add_osc_method,
        osc::commands::set_osc_method_value,
        osc::commands::set_osc_receive_address_whitelist,
        elevated_sidecar::commands::elevated_sidecar_started,
        elevated_sidecar::commands::start_elevated_sidecar,
        elevated_sidecar::commands::elevated_sidecar_get_grpc_web_port,
        elevated_sidecar::commands::elevated_sidecar_get_grpc_port,
        overlay_sidecar::commands::start_overlay_sidecar,
        overlay_sidecar::commands::overlay_sidecar_get_grpc_web_port,
        overlay_sidecar::commands::overlay_sidecar_get_grpc_port,
        system_tray::commands::set_close_to_system_tray,
        vrc_log_parser::commands::init_vrc_log_watcher,
        discord::commands::discord_update_activity,
        discord::commands::discord_clear_activity,
        http::commands::get_http_server_port,
        image_cache::commands::clean_image_cache,
        lighthouse::commands::lighthouse_start_scan,
        lighthouse::commands::lighthouse_get_devices,
        lighthouse::commands::lighthouse_set_device_power_state,
        lighthouse::commands::lighthouse_get_device_power_state,
        lighthouse::commands::lighthouse_get_status,
        lighthouse::commands::lighthouse_get_scanning_status,
        lighthouse::commands::lighthouse_reset,
        steam::commands::steam_active,
        steam::commands::steam_achievement_get,
        steam::commands::steam_achievement_set,
        commands::log_utils::clear_log_files,
        commands::afterburner::msi_afterburner_set_profile,
        commands::notifications::xsoverlay_send_message,
        commands::splash::close_splashscreen,
        commands::nvml::nvml_status,
        commands::nvml::nvml_get_devices,
        commands::nvml::nvml_set_power_management_limit,
        commands::debug::open_dev_tools,
        commands::debug::is_flag_set,
        commands::time::get_sunrise_sunset_time,
        grpc::commands::get_core_grpc_port,
        grpc::commands::get_core_grpc_web_port,
        telemetry::commands::set_telemetry_enabled,
    ]
}
