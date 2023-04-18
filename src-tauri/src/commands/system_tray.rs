use tauri::Manager;
use tauri::{
    AppHandle, CustomMenuItem, Runtime, SystemTray, SystemTrayEvent, SystemTrayMenu,
};

const QUIT: &'static str = "quit";

pub fn init() -> SystemTray {
    // Menus
    let menu_quit = CustomMenuItem::new(QUIT, "Quit");

    let tray_menu = SystemTrayMenu::new()
        //.add_native_item(SystemTrayMenuItem::Separator)
        .add_item(menu_quit);

    let tray = SystemTray::new().with_menu(tray_menu);

    return tray;
}

pub fn event_handler<R: Runtime>() -> impl Fn(&AppHandle<R>, SystemTrayEvent) + Send + Sync + 'static
{
    return |app, event| match event {
        SystemTrayEvent::MenuItemClick { id, .. } => {
            match id.as_str() {
                QUIT => std::process::exit(0),
                _ => {}
            }
        },

        // When clicking the tray icon, restore and focus window.
        SystemTrayEvent::LeftClick { tray_id, .. } => {
            let window = app.get_window("main").unwrap();
            window.show().unwrap();
            window.set_focus().unwrap();
        }
        _ => {}
    };
}

#[tauri::command]
pub fn set_exit_with_system_tray(app_handle: AppHandle, status: bool) {
    // TODO : use something similar as lazy statics (see main.rs)
    println!("Rust has been called");
}