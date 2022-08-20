#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
#![feature(io_error_more)]

#[macro_use(lazy_static)]
extern crate lazy_static;

use std::sync::Mutex;
use tauri_plugin_store::PluginBuilder;
extern crate cronjob;
use cronjob::CronJob;

use models::OVRDevice;
use openvr::{TrackedDeviceIndex, MAX_TRACKED_DEVICE_COUNT};
use tauri::Manager;

mod background;
mod models;

lazy_static! {
    static ref OVR_CONTEXT: Mutex<Option<openvr::Context>> = Default::default();
    static ref TAURI_WINDOW: Mutex<Option<tauri::Window>> = Default::default();
    static ref OVR_STATUS: Mutex<String> = Mutex::new(String::from("INITIALIZING"));
}

#[tauri::command]
fn openvr_get_devices() -> Result<Vec<OVRDevice>, String> {
    let context_guard = OVR_CONTEXT.lock().unwrap();
    let context = match context_guard.as_ref() {
        Some(ctx) => ctx,
        None => return Err("ERROR_OVR_NOT_INITIALIZED".into()),
    };
    let mut devices: Vec<OVRDevice> = Vec::new();
    let system = context.system().unwrap();
    for device_index in 0..(MAX_TRACKED_DEVICE_COUNT as TrackedDeviceIndex) {
        let device_class = match system.tracked_device_class(device_index) {
            openvr::TrackedDeviceClass::Invalid => continue,
            other => other,
        };
        devices.push(OVRDevice {
            index: device_index,
            class: device_class,
            battery: system
                .float_tracked_device_property(
                    device_index,
                    openvr::property::DeviceBatteryPercentage_Float,
                )
                .ok(),
            provides_battery_status: system
                .bool_tracked_device_property(
                    device_index,
                    openvr::property::DeviceProvidesBatteryStatus_Bool,
                )
                .ok(),
            can_power_off: system
                .bool_tracked_device_property(
                    device_index,
                    openvr::property::DeviceCanPowerOff_Bool,
                )
                .ok(),
            is_charging: system
                .bool_tracked_device_property(device_index, openvr::property::DeviceIsCharging_Bool)
                .ok(),
            dongle_id: match system
                .string_tracked_device_property(
                    device_index,
                    openvr::property::ConnectedWirelessDongle_String,
                )
                .ok()
            {
                Some(value) => Some(value.into_string().unwrap()),
                None => None,
            },
            serial_number: match system
                .string_tracked_device_property(device_index, openvr::property::SerialNumber_String)
                .ok()
            {
                Some(value) => Some(value.into_string().unwrap()),
                None => None,
            },
            hardware_revision: match system
                .string_tracked_device_property(
                    device_index,
                    openvr::property::HardwareRevision_String,
                )
                .ok()
            {
                Some(value) => Some(value.into_string().unwrap()),
                None => None,
            },
            manufacturer_name: match system
                .string_tracked_device_property(
                    device_index,
                    openvr::property::ManufacturerName_String,
                )
                .ok()
            {
                Some(value) => Some(value.into_string().unwrap()),
                None => None,
            },
            model_number: match system
                .string_tracked_device_property(device_index, openvr::property::ModelNumber_String)
                .ok()
            {
                Some(value) => Some(value.into_string().unwrap()),
                None => None,
            },
        })
    }
    Ok(devices)
}

#[tauri::command]
async fn run_command(command: String, args: Vec<String>) -> Result<models::Output, String> {
    let output = match tauri::api::process::Command::new(command)
        .args(args)
        .output()
    {
        Ok(output) => output,
        Err(error) => match error {
            tauri::api::Error::Io(io_err) => match io_err.kind() {
                std::io::ErrorKind::NotFound => return Err(String::from("NOT_FOUND")),
                std::io::ErrorKind::PermissionDenied => 
                    return Err(String::from("PERMISSION_DENIED")),           
                std::io::ErrorKind::InvalidFilename => 
                    return Err(String::from("INVALID_FILENAME")),           
                other => {
                    eprintln!("Unknown IO Error occurred: {}", other);
                    return Err(String::from("UNKNOWN_ERROR"));
                }
            },
            other => {
                eprintln!("Unknown error occurred: {}", other);
                return Err(String::from("UNKNOWN_ERROR"));
            }
        },
    };

    Ok(models::Output {
        stdout: output.stdout,
        stderr: output.stderr,
        status: output.status.code().unwrap_or_default(),
    })
}

#[tauri::command]
async fn close_splashscreen(window: tauri::Window) {
    // Close splashscreen
    if let Some(splashscreen) = window.get_window("splashscreen") {
        splashscreen.close().unwrap();
    }
    // Show main window
    window.get_window("main").unwrap().show().unwrap();
}

#[tauri::command]
async fn openvr_status() -> String {
    OVR_STATUS.lock().unwrap().clone()
}

fn main() {
    tauri::Builder::default()
        .plugin(PluginBuilder::default().build())
        .setup(|app| {
            // Set up window reference
            let window = app.get_window("main").unwrap();
            *TAURI_WINDOW.lock().unwrap() = Some(window);
            // Initialize OpenVR
            std::thread::spawn(|| -> () {
                // Initialize OpenVR
                let ovr_context = match unsafe { openvr::init(openvr::ApplicationType::Overlay) } {
                    Ok(ctx) => Some(ctx),
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
            });
            // Setup start of minute cronjob
            let mut cron = CronJob::new("CRON_MINUTE_START", on_cron_minute_start);
            cron.seconds("0");
            CronJob::start_job_threaded(cron);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            openvr_get_devices,
            run_command,
            close_splashscreen,
            openvr_status
        ])
        .run(tauri::generate_context!())
        .expect("An error occurred while running the application");
}

fn on_cron_minute_start(_: &str) {
    let window_guard = TAURI_WINDOW.lock().unwrap();
    let window = window_guard.as_ref().unwrap();
    let _ = window.emit_all("CRON_MINUTE_START", ());
}
