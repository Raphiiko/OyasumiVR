use log::{info, warn};
use winreg::enums::*;
use winreg::RegKey;

// Due to the rebrand from "Oyasumi" to "OyasumiVR", the new NSIS installer does not
// uninstall the previous installation. This migration looks for any old WIX based installations
// prior to Oyasumi v1.7.0, and uninstalls them passively.

pub async fn run() {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let uninstall = match hklm
        .open_subkey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall")
    {
        Ok(key) => key,
        Err(e) => {
            warn!("[Core] Failed to open read uninstall key from Windows registry for migrating old versions: {}", e);
            return;
        }
    };
    let keys = uninstall.enum_keys();

    // Attempt to find uninstaller key for an old version
    let old_version = keys
        .into_iter()
        .find(|x| {
            let sub_path = match x {
                Ok(sub_path) => sub_path,
                Err(_) => {
                    return false;
                }
            };
            let key = match uninstall.open_subkey(sub_path) {
                Ok(key) => key,
                Err(_) => {
                    return false;
                }
            };
            let display_name: String = match key.get_value("DisplayName") {
                Ok(display_name) => display_name,
                Err(_) => {
                    return false;
                }
            };
            let publisher: String = match key.get_value("Publisher") {
                Ok(publisher) => publisher,
                Err(_) => {
                    return false;
                }
            };
            let version_major: u32 = match key.get_value("VersionMajor") {
                Ok(version_major) => version_major,
                Err(_) => {
                    return false;
                }
            };
            let version_minor: u32 = match key.get_value("VersionMinor") {
                Ok(version_minor) => version_minor,
                Err(_) => {
                    return false;
                }
            };
            // Match any Oyasumi version before 1.7
            let has_match = display_name == "Oyasumi"
                && publisher == "raphii"
                && (version_major < 1 || (version_major == 1 && version_minor <= 6));
            if has_match {
                info!(
                    "[Core] Found old Oyasumi version ({}.{}). Uninstalling it...",
                    version_major, version_minor
                );
            }
            has_match
        })
        .map(|r| r.unwrap());
    if old_version.is_none() {
        return;
    }
    // Get the uninstall entry
    let old_version = old_version.unwrap();
    let uninstall_entry = match uninstall.open_subkey(old_version) {
        Ok(key) => key,
        Err(e) => {
            warn!(
                "[Core] Failed to get uninstall entry for old Oyasumi version: {}",
                e
            );
            return;
        }
    };
    // Get the uninstall string
    let uninstall_string: String = match uninstall_entry.get_value("UninstallString") {
        Ok(uninstall_string) => uninstall_string,
        Err(e) => {
            warn!(
                "[Core] Failed to get uninstall string for old Oyasumi version: {}",
                e
            );
            return;
        }
    };
    // Run the uninstallation string passively
    let mut command = std::process::Command::new("cmd");
    command.arg("/C").arg(uninstall_string + " /passive");
    match command.spawn() {
        Ok(_) => {
            info!("[Core] Old Oyasumi version was uninstalled successfully!");
        }
        Err(e) => {
            warn!("[Core] Failed to uninstall old Oyasumi version: {}", e);
        }
    }
}
