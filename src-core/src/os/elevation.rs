use oyasumivr_shared::windows::is_elevated;
use winreg::enums::*;
use winreg::RegKey;

use crate::globals::TAURI_CLI_MATCHES;

pub async fn process_elevation_cli_args() {
    let match_guard = TAURI_CLI_MATCHES.lock().await;
    fn is_flag_present(matches: &tauri_plugin_cli::Matches, flag_name: &str) -> bool {
        matches
            .args
            .get(flag_name)
            .is_some_and(|data| data.occurrences >= 1)
    }
    if let Some(matches) = match_guard.as_ref() {
        if is_flag_present(matches, "reset-elevation-security") {
            drop(match_guard);
            reset_elevation_security().await;
        } else if is_flag_present(matches, "dont-need-security-where-im-going-uwu") {
            drop(match_guard);
            disable_elevation_security().await;
        }
    }
}

async fn reset_elevation_security() {
    if !is_elevated() {
        eprintln!("In order to reset elevation security, OyasumiVR.exe must be run with administrative privileges.");
        std::process::exit(1);
    }

    // Clear the registry flag
    match clear_elevation_security_override_registry_flag() {
        Ok(_) => {
            println!("[Core] Elevation security has been reset. OyasumiVR will no longer run with administrative privileges.");
        }
        Err(e) => {
            eprintln!("[Core] Failed to reset elevation security: {}", e);
        }
    }
    std::process::exit(0);
}

async fn disable_elevation_security() {
    if !is_elevated() {
        eprintln!("In order to disable elevation security, OyasumiVR.exe must be run with administrative privileges.");
        std::process::exit(1);
    }

    // Set the registry flag
    match set_elevation_security_override_registry_flag() {
        Ok(_) => {
            println!("Elevation security has been disabled. You can now run OyasumiVR with administrative privileges.");
        }
        Err(e) => {
            eprintln!("[Core] Failed to disable elevation security: {}", e);
        }
    }
    std::process::exit(0);
}

fn set_elevation_security_override_registry_flag() -> Result<(), std::io::Error> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let (key, _) = hklm.create_subkey("SOFTWARE\\OyasumiVR")?;
    key.set_value("ElevationSecurityOverride", &1u32)?;
    Ok(())
}

fn clear_elevation_security_override_registry_flag() -> Result<(), std::io::Error> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // Try to open the key first
    match hklm.open_subkey_with_flags("SOFTWARE\\OyasumiVR", KEY_WRITE) {
        Ok(key) => {
            // If the key exists, try to delete the value
            match key.delete_value("ElevationSecurityOverride") {
                Ok(_) => Ok(()),
                Err(e) => {
                    // If the value doesn't exist, that's fine - it means it's already cleared
                    if e.kind() == std::io::ErrorKind::NotFound {
                        Ok(())
                    } else {
                        Err(e)
                    }
                }
            }
        }
        Err(e) => {
            // If the key doesn't exist, that's fine - it means the flag was never set
            if e.kind() == std::io::ErrorKind::NotFound {
                Ok(())
            } else {
                Err(e)
            }
        }
    }
}

pub fn is_elevation_security_disabled() -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    match hklm.open_subkey("SOFTWARE\\OyasumiVR") {
        Ok(key) => match key.get_value::<u32, _>("ElevationSecurityOverride") {
            Ok(value) => value == 1,
            Err(_) => false,
        },
        Err(_) => false,
    }
}
