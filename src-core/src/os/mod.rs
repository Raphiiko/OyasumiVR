pub mod commands;
pub mod dotnet;
mod models;

use log::error;
use soloud::*;
use std::{collections::HashMap, sync::Mutex};
use winapi::shared::guiddef::GUID;
use winapi::um::powersetting::{PowerGetActiveScheme, PowerSetActiveScheme};
use winapi::DEFINE_GUID;

lazy_static! {
    static ref SOUNDS: Mutex<HashMap<String, Vec<u8>>> = Mutex::new(HashMap::new());
    static ref SOLOUD: Mutex<Soloud> = Mutex::new(Soloud::default().unwrap());
}

pub fn load_sounds() {
    let mut sounds = SOUNDS.lock().unwrap();
    sounds.insert(
        String::from("notification_bell"),
        std::fs::read("resources/sounds/notification_bell.ogg").unwrap(),
    );
    sounds.insert(
        String::from("notification_block"),
        std::fs::read("resources/sounds/notification_block.ogg").unwrap(),
    );
}

DEFINE_GUID! {GUID_POWER_POLICY_POWER_SAVING,
0xa1841308, 0x3541, 0x4fab, 0xbc, 0x81, 0xf7, 0x15, 0x56, 0xf2, 0x0b, 0x4a}
DEFINE_GUID! {GUID_POWER_POLICY_BALANCED,
0x381b4222, 0xf694, 0x41f0, 0x96, 0x85, 0xff, 0x5b, 0xb2, 0x60, 0xdf, 0x2e}
DEFINE_GUID! {GUID_POWER_POLICY_HIGH_PERFORMANCE,
0x8c5e7fda, 0xe8bf, 0x4a96, 0x9a, 0x85, 0xa6, 0xe2, 0x3a, 0x8c, 0x63, 0x5c}

fn active_windows_power_policy() -> Option<GUID> {
    unsafe {
        let mut guid: *mut GUID = std::ptr::null_mut();
        if PowerGetActiveScheme(std::ptr::null_mut(), &mut guid) == 0 && !guid.is_null() {
            Some(*guid)
        } else {
            None
        }
    }
}

fn set_windows_power_policy(guid: &GUID) -> bool {
    let result = unsafe { PowerSetActiveScheme(std::ptr::null_mut(), guid) };
    if result != 0 {
        error!(
            "[Core] Failed to set Windows power policy. Result code {:?}",
            result
        );
    };
    result == 0
}

fn guid_equal(a: &GUID, b: &GUID) -> bool {
    (a.Data1 == b.Data1) && (a.Data2 == b.Data2) && (a.Data3 == b.Data3) && (a.Data4 == b.Data4)
}