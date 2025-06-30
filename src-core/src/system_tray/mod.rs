use std::sync::LazyLock;
use tauri::{
    tray::{MouseButton, MouseButtonState},
    Manager, Runtime,
};
use tokio::sync::Mutex;

pub mod commands;

use crate::{globals::TAURI_APP_HANDLE, utils::send_event};

pub static SYSTEMTRAY_MANAGER: LazyLock<Mutex<Option<SystemTrayManager>>> = LazyLock::new(Default::default);

#[derive(Debug, Clone)]
pub struct SystemTrayManager {
    pub close_to_tray: bool,
}

impl SystemTrayManager {
    pub fn new() -> SystemTrayManager {
        SystemTrayManager {
            close_to_tray: false,
        }
    }
}

pub async fn init() {
    // Initialize the system tray manager
    let system_tray_manager = SystemTrayManager::new();
    *SYSTEMTRAY_MANAGER.lock().await = Some(system_tray_manager);
    // Listen to system tray events
    let app_guard = TAURI_APP_HANDLE.lock().await;
    let app = app_guard.as_ref().unwrap();
    let tray = app.tray_by_id("oyasumivr-tray").unwrap();
    tray.on_tray_icon_event(|icon, event| {
        futures::executor::block_on(on_tray_icon_event(icon, event))
    });
}

pub fn handle_window_events(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let manager_guard = futures::executor::block_on(SYSTEMTRAY_MANAGER.lock());
        let manager = manager_guard.as_ref().unwrap();
        handle_window_close_request(window, Some(api), manager.close_to_tray);
    }
}

async fn on_tray_icon_event(_icon: &tauri::tray::TrayIcon, event: tauri::tray::TrayIconEvent) {
    match event {
        tauri::tray::TrayIconEvent::Click {
            id: _,
            position: _,
            rect: _,
            button,
            button_state,
        } => {
            if button_state == MouseButtonState::Up {
                let _ = send_event("system_tray_click", button).await;
                if button == MouseButton::Left {
                    let app_guard = TAURI_APP_HANDLE.lock().await;
                    let app = app_guard.as_ref().unwrap();
                    let window = app.get_webview_window("main").unwrap();
                    if !window.is_visible().unwrap() {
                        window.show().unwrap();
                    }
                    window.set_focus().unwrap();
                }
            }
        }
        tauri::tray::TrayIconEvent::DoubleClick {
            id: _,
            position: _,
            rect: _,
            button,
        } => {
            let _ = send_event("system_tray_double_click", button).await;
        }
        _ => {}
    }
}

fn handle_window_close_request<R: Runtime>(
    window: &tauri::Window<R>,
    api: Option<&tauri::CloseRequestApi>,
    close_to_tray: bool,
) {
    if close_to_tray {
        window.hide().unwrap();
        if let Some(api) = api {
            api.prevent_close();
        }
    } else if api.is_none() {
        window.close().unwrap();
    }
}
