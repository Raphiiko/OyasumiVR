#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
#![feature(io_error_more)]

#[macro_use(lazy_static)]
extern crate lazy_static;

use cronjob::CronJob;
use models::{NVMLDevice, OVRDevice};
use nvml_wrapper::Nvml;
use openvr::{TrackedDeviceIndex, MAX_TRACKED_DEVICE_COUNT};
use rosc::{encoder, OscMessage, OscPacket, OscType};
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::str::FromStr;
use std::sync::Mutex;
use std::{ffi::OsStr, os::windows::ffi::OsStrExt, ptr};
use tauri::Manager;
use tauri_plugin_store::PluginBuilder;
use windows_sys::Win32::UI::Shell::ShellExecuteW;

mod background;
mod models;
mod windows_oyasumi;

lazy_static! {
    static ref OVR_CONTEXT: Mutex<Option<openvr::Context>> = Default::default();
    static ref TAURI_WINDOW: Mutex<Option<tauri::Window>> = Default::default();
    static ref OVR_STATUS: Mutex<String> = Mutex::new(String::from("INITIALIZING"));
    static ref NVML_STATUS: Mutex<String> = Mutex::new(String::from("INITIALIZING"));
    static ref NVML_HANDLE: Mutex<Option<Nvml>> = Default::default();
    static ref OSC_SOCKET: Mutex<Option<UdpSocket>> = Default::default();
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
                std::io::ErrorKind::PermissionDenied => {
                    return Err(String::from("PERMISSION_DENIED"))
                }
                std::io::ErrorKind::InvalidFilename => {
                    return Err(String::from("INVALID_FILENAME"))
                }
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

#[tauri::command]
async fn nvml_status() -> String {
    NVML_STATUS.lock().unwrap().clone()
}

#[tauri::command]
async fn nvml_get_devices() -> Vec<NVMLDevice> {
    let nvml_guard = NVML_HANDLE.lock().unwrap();
    let nvml = nvml_guard.as_ref().unwrap();
    let count = nvml.device_count().unwrap();
    let mut gpus: Vec<NVMLDevice> = Vec::new();
    for n in 0..count {
        let device = match nvml.device_by_index(n) {
            Ok(device) => device,
            Err(err) => {
                println!(
                    "Could not access GPU at index {} due to an error: {:#?}",
                    n, err
                );
                continue;
            }
        };
        let constraints = device.power_management_limit_constraints().ok();
        gpus.push(NVMLDevice {
            uuid: device.uuid().unwrap(),
            name: device.name().unwrap(),
            power_limit: device.power_management_limit().ok(),
            min_power_limit: constraints.as_ref().and_then(|c| Some(c.min_limit)),
            max_power_limit: constraints.as_ref().and_then(|c| Some(c.max_limit)),
            default_power_limit: device.power_management_limit_default().ok(),
        });
    }
    gpus
}

#[tauri::command]
async fn nvml_set_power_management_limit(uuid: String, limit: u32) -> Result<bool, String> {
    let nvml_guard = NVML_HANDLE.lock().unwrap();
    let nvml = nvml_guard.as_ref().unwrap();

    let mut device = match nvml.device_by_uuid(uuid.clone()) {
        Ok(device) => device,
        Err(err) => {
            println!(
                "Could not access GPU (uuid:{:#?}) due to an error: {:#?}",
                uuid, err
            );
            return Err(String::from("DEVICE_ACCESS_ERROR"));
        }
    };

    match device.set_power_management_limit(limit) {
        Err(err) => {
            println!(
                "Could not set power limit for GPU (uuid:{:#?}) due to an error: {:#?}",
                uuid.clone(),
                err
            );
            return Err(String::from("DEVICE_SET_POWER_LIMIT_ERROR"));
        }
        _ => (),
    }

    Ok(true)
}

#[tauri::command]
fn windows_is_elevated() -> bool {
    windows_oyasumi::is_app_elevated()
}

#[tauri::command]
fn windows_relaunch_with_elevation() {
    // Disconnect from SteamVR
    let context_guard = OVR_CONTEXT.lock().unwrap();
    let ovr_context = context_guard.as_ref();
    if let Some(ctx) = ovr_context {
        ctx.system().unwrap().acknowledge_quit_exiting();
        unsafe {
            ctx.shutdown();
        }
    }
    // Launch as administrator
    let exe_path = std::env::current_exe().unwrap();
    let path = exe_path.as_os_str();
    let mut maybe_result: Vec<_> = path.encode_wide().collect();
    maybe_result.push(0);
    let path = maybe_result;
    let operation: Vec<u16> = OsStr::new("runas\0").encode_wide().collect();
    let r = unsafe {
        ShellExecuteW(
            0,
            operation.as_ptr(),
            path.as_ptr(),
            ptr::null(),
            ptr::null(),
            0,
        )
    };
    // Quit non-admin process if successful (self)
    if r > 32 {
        std::process::exit(0);
    }
}

#[tauri::command]
fn osc_init() -> bool {
    *OSC_SOCKET.lock().unwrap() = match UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) {
        Ok(s) => Some(s),
        Err(err) => {
            eprintln!("{err}");
            return false;
        }
    };
    true
}

#[tauri::command]
fn osc_send_int(addr: String, osc_addr: String, data: i32) -> Result<bool, String> {
    osc_send(addr, osc_addr, vec![OscType::Int(data)])
}

#[tauri::command]
fn osc_send_float(addr: String, osc_addr: String, data: f32) -> Result<bool, String> {
    osc_send(addr, osc_addr, vec![OscType::Float(data)])
}

#[tauri::command]
fn osc_send_bool(addr: String, osc_addr: String, data: bool) -> Result<bool, String> {
    osc_send(addr, osc_addr, vec![OscType::Bool(data)])
}

#[tauri::command]
fn osc_valid_addr(addr: String) -> bool {
    match SocketAddrV4::from_str(addr.as_str()) {
        Ok(_) => true,
        Err(_) => false,
    }
}

fn osc_send(addr: String, osc_addr: String, data: Vec<OscType>) -> Result<bool, String> {
    // Get socket
    let socket_guard = OSC_SOCKET.lock().unwrap();
    let socket = match socket_guard.as_ref() {
        Some(socket) => socket,
        None => return Err(String::from("NO_SOCKET")),
    };
    // Parse address
    let to_addr = match SocketAddrV4::from_str(addr.as_str()) {
        Ok(addr) => addr,
        Err(_) => return Err(String::from("INVALID_ADDRESS")),
    };
    // Construct message
    let msg_buf = encoder::encode(&OscPacket::Message(OscMessage {
        addr: osc_addr,
        args: data,
    }))
    .unwrap();
    // Send message
    match socket.send_to(&msg_buf, to_addr) {
        Err(_) => return Err(String::from("SENDING_ERROR")),
        _ => (),
    }
    Ok(true)
}

fn main() {
    tauri::Builder::default()
        .plugin(PluginBuilder::default().build())
        .setup(|app| {
            // Set up window reference
            let window = app.get_window("main").unwrap();
            window.open_devtools();
            *TAURI_WINDOW.lock().unwrap() = Some(window);
            std::thread::spawn(|| -> () {
                // Initialize OpenVR
                let ovr_context = match unsafe { openvr::init(openvr::ApplicationType::Utility) } {
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
            openvr_get_devices,
            run_command,
            close_splashscreen,
            openvr_status,
            nvml_status,
            nvml_get_devices,
            nvml_set_power_management_limit,
            windows_is_elevated,
            windows_relaunch_with_elevation,
            osc_send_bool,
            osc_send_float,
            osc_send_int,
            osc_init,
            osc_valid_addr,
        ])
        .run(tauri::generate_context!())
        .expect("An error occurred while running the application");
}

fn on_cron_minute_start(_: &str) {
    let window_guard = TAURI_WINDOW.lock().unwrap();
    let window = window_guard.as_ref().unwrap();
    let _ = window.emit_all("CRON_MINUTE_START", ());
}
