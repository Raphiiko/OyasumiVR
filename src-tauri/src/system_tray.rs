use tauri::Manager;
use tauri::{
    AppHandle, CustomMenuItem, Runtime, SystemTray, SystemTrayEvent, SystemTrayMenu,
    SystemTrayMenuItem,
};

const SLEEPMODE: &'static str = "sleepmode";
const QUIT: &'static str = "quit";

pub fn init() -> SystemTray {
    // Menus
    let menu_sleepmode = CustomMenuItem::new(SLEEPMODE, "Enable sleep mode");
    let menu_quit = CustomMenuItem::new(QUIT, "Quit");

    let tray_menu = SystemTrayMenu::new()
        .add_item(menu_sleepmode)
        .add_native_item(SystemTrayMenuItem::Separator)
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
                SLEEPMODE => {
                    // TODO
                }
                _ => {}
            }
        }
        _ => {}
    };
}