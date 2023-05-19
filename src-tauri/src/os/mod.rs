pub mod commands;
mod models;

use soloud::*;
use std::{collections::HashMap, sync::Mutex};

lazy_static! {
    static ref SOUNDS: Mutex<HashMap<String, Vec<u8>>> = Mutex::new(HashMap::new());
    static ref SOLOUD: Mutex<Soloud> = Mutex::new(Soloud::default().unwrap());
}

pub fn load_sounds() {
    let mut sounds = SOUNDS.lock().unwrap();
    sounds.insert(
        String::from("notification_bell"),
        std::fs::read("sounds/notification_bell.ogg").unwrap(),
    );
    sounds.insert(
        String::from("notification_block"),
        std::fs::read("sounds/notification_block.ogg").unwrap(),
    );
}
