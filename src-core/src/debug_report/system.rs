use serde_json::{json, Value};
use sysinfo::{CpuRefreshKind, ProcessesToUpdate, System};
use windows::core::Interface;
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIDevice, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};

use crate::{elevated_sidecar::launcher, globals::STEAM_APP_KEY};

/// Other VR tools whose presence often explains an issue.
const OTHER_VR_APPS: &[&str] = &[
    "XSOverlay.exe",
    "AdvancedSettings.exe",
    "VRCX.exe",
    "VirtualDesktop.Streamer.exe",
    "OVRServer_x64.exe",
    "vrmonitor.exe",
    "VRChat.exe",
];

pub async fn collect() -> Value {
    let launcher_state = tokio::task::spawn_blocking(launcher::state)
        .await
        .ok()
        .and_then(|state| serde_json::to_value(state).ok());
    let last_launcher_result = launcher::last_launcher_result().map(
        |code| json!({ "code": code, "description": launcher::describe_launcher_result(code) }),
    );

    let mut running_apps = Vec::new();
    for name in OTHER_VR_APPS {
        if crate::utils::is_process_active(name, false).await {
            running_apps.push(*name);
        }
    }

    let devices = crate::openvr::devices::get_devices().await;

    json!({
        "createdAt": chrono::Local::now().to_rfc3339(),
        "app": {
            "version": env!("CARGO_PKG_VERSION"),
            "installDir": std::env::current_exe().ok().and_then(|exe| exe.parent().map(|p| p.display().to_string())),
            "arguments": std::env::args().skip(1).collect::<Vec<_>>(),
            "webview2Version": tauri::webview_version().ok(),
        },
        "system": system_info(),
        "runningApps": running_apps,
        "elevatedFeatures": {
            "usesScheduledTask": crate::elevated_sidecar::uses_scheduled_task().await,
            "sidecarStarted": crate::elevated_sidecar::commands::elevated_sidecar_started().await,
            "launcherState": launcher_state,
            "lastLauncherResult": last_launcher_result,
        },
        "steamvr": {
            "devices": serde_json::to_value(devices).unwrap_or(Value::Null),
            "application": steamvr_application().await,
        },
    })
}

/// The manifest registration and auto-launch flag SteamVR holds for OyasumiVR.
/// Null while SteamVR is not connected.
async fn steamvr_application() -> Value {
    let context = crate::openvr::OVR_CONTEXT.lock().await;
    let Some(context) = context.as_ref() else {
        return Value::Null;
    };
    let applications = context.applications();
    json!({
        "manifestRegistered": applications.is_application_installed(STEAM_APP_KEY).ok(),
        "autoLaunch": applications.get_application_auto_launch(STEAM_APP_KEY).ok(),
    })
}

fn system_info() -> Value {
    let mut system = System::new();
    system.refresh_cpu_list(CpuRefreshKind::nothing());
    system.refresh_memory();
    let pid = sysinfo::get_current_pid().ok();
    if let Some(pid) = pid {
        system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    }

    json!({
        "os": System::long_os_version(),
        "kernel": System::kernel_long_version(),
        "cpu": system.cpus().first().map(|cpu| cpu.brand().trim().to_string()),
        "cpuCores": system.cpus().len(),
        "totalMemoryBytes": system.total_memory(),
        "processMemoryBytes": pid.and_then(|pid| system.process(pid)).map(|p| p.memory()),
        "gpus": gpus(),
    })
}

fn gpus() -> Vec<Value> {
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return Vec::new();
    };
    let mut gpus = Vec::new();
    for index in 0.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
            break;
        };
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
            continue;
        }
        let name_len = desc
            .Description
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(desc.Description.len());
        let driver_version = unsafe { adapter.CheckInterfaceSupport(&IDXGIDevice::IID) }
            .ok()
            .map(|v| {
                let v = v as u64;
                format!(
                    "{}.{}.{}.{}",
                    v >> 48,
                    (v >> 32) & 0xffff,
                    (v >> 16) & 0xffff,
                    v & 0xffff
                )
            });
        gpus.push(json!({
            "name": String::from_utf16_lossy(&desc.Description[..name_len]),
            "vendorId": format!("{:04x}", desc.VendorId),
            "dedicatedMemoryBytes": desc.DedicatedVideoMemory,
            "driverVersion": driver_version,
        }));
    }
    gpus
}
