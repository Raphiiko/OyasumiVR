pub mod commands;

use tauri::{AppHandle, CustomMenuItem, Runtime, SystemTray, SystemTrayEvent, SystemTrayMenu};
use tauri::{GlobalWindowEvent, Manager};
use tokio::sync::Mutex;

const QUIT: &str = "quit";

lazy_static! {
    pub static ref SYSTEMTRAY_MANAGER: Mutex<Option<SystemTrayManager>> = Default::default();
}

#[derive(Debug, Clone)]
pub struct SystemTrayManager {
    pub close_to_tray: bool,
    pub start_in_tray: bool,
}

impl SystemTrayManager {
    pub fn new() -> SystemTrayManager {
        SystemTrayManager {
            close_to_tray: false,
            start_in_tray: false,
        }
    }
}

pub async fn init() {
    // Initialize the system tray manager
    let system_tray_manager = SystemTrayManager::new();
    *SYSTEMTRAY_MANAGER.lock().await = Some(system_tray_manager);
}

// Initializes the system tray with menus.
pub fn init_system_tray() -> SystemTray {
    // Menus
    let menu_quit = CustomMenuItem::new(QUIT, "Quit Oyasumi");

    let tray_menu = SystemTrayMenu::new()
        //.add_native_item(SystemTrayMenuItem::Separator)
        .add_item(menu_quit);

    SystemTray::new().with_menu(tray_menu)
}

pub fn handle_system_tray_events<R: Runtime>(
) -> impl Fn(&AppHandle<R>, SystemTrayEvent) + Send + Sync + 'static {
    |app, event| {
        match event {
            SystemTrayEvent::MenuItemClick { id, .. } => {
                if id.as_str() == QUIT {
                    app.exit(0);
                }
            }
            // When clicking the tray icon, restore and focus window.
            SystemTrayEvent::LeftClick { .. } => {
                let window = app.get_window("main").unwrap();
                window.show().unwrap();
                window.set_focus().unwrap();
            }
            _ => {}
        };
    }
}

pub fn handle_window_events<R: Runtime>() -> impl Fn(GlobalWindowEvent<R>) + Send + Sync + 'static {
    |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
            let manager_guard = tauri::async_runtime::block_on(SYSTEMTRAY_MANAGER.lock());
            let manager = manager_guard.as_ref().unwrap();
            if manager.close_to_tray {
                event.window().hide().unwrap();
                api.prevent_close();
            }
        }
    }
}
