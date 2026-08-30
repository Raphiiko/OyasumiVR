use crate::{exit, log, paths};
use oyasumivr_shared::windows::{
    current_user_sid, is_elevated, protect_directory, PrivilegedLauncherLock,
    PRIVILEGED_LAUNCHER_CLEANUP_TOKEN,
};
use oyasumivr_shared::{elevated_sidecar_key_id, task, PRIVILEGED_LAUNCHER_VERSION};
use serde::Serialize;

#[derive(Serialize)]
struct Marker {
    version: u32,
    /// Lets the core spot a launcher built with a different signing key.
    key: String,
}

pub fn run() -> u8 {
    if !is_elevated() {
        log("[install] refusing to install without elevation");
        return exit::NOT_ELEVATED;
    }
    let Ok(_lock) = PrivilegedLauncherLock::acquire() else {
        log("[install] could not lock the privileged launcher installation");
        return exit::INSTALL_FAILED;
    };

    let (Ok(dir), Ok(staged), Ok(target), Ok(marker)) = (
        paths::privileged_dir(),
        paths::staged_root(),
        paths::installed_launcher(),
        paths::launcher_marker(),
    ) else {
        log("[install] could not resolve the Program Files layout");
        return exit::INSTALL_FAILED;
    };

    match std::fs::remove_file(dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN)) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            log(&format!("[install] cannot cancel pending cleanup: {e}"));
            return exit::INSTALL_FAILED;
        }
    }

    // Both hold binaries that run elevated, so neither may be writable for the user, whatever
    // Program Files would have granted them by inheritance.
    for directory in [&dir, &staged] {
        if let Err(e) = std::fs::create_dir_all(directory) {
            log(&format!(
                "[install] cannot create {}: {e}",
                directory.display()
            ));
            return exit::INSTALL_FAILED;
        }
        if let Err(e) = protect_directory(directory) {
            log(&format!(
                "[install] cannot secure {}: {e}",
                directory.display()
            ));
            return exit::INSTALL_FAILED;
        }
    }
    let _ = std::fs::remove_file(dir.join("launcher.log"));

    let Ok(current) = std::env::current_exe() else {
        log("[install] cannot find my own path");
        return exit::INSTALL_FAILED;
    };
    // skipped when already in place, so a reinstall does not trip over a locked file
    if current != target {
        if let Err(e) = std::fs::copy(&current, &target) {
            log(&format!(
                "[install] cannot copy myself to {}: {e}",
                target.display()
            ));
            return exit::INSTALL_FAILED;
        }
    }

    let sid = match current_user_sid() {
        Ok(sid) => sid,
        Err(e) => {
            log(&format!("[install] cannot read my own user sid: {e}"));
            return exit::INSTALL_FAILED;
        }
    };

    if let Err(e) = task::register(&target, &staged, &sid) {
        log(&format!("[install] cannot register the task: {e}"));
        return exit::TASK_REGISTRATION_FAILED;
    }

    // Written last: the core reads it as proof that a task is registered, and spends a UAC prompt
    // when it is missing.
    let payload = match serde_json::to_vec(&Marker {
        version: PRIVILEGED_LAUNCHER_VERSION,
        key: elevated_sidecar_key_id().to_string(),
    }) {
        Ok(payload) => payload,
        Err(e) => {
            log(&format!("[install] cannot build the marker: {e}"));
            return exit::INSTALL_FAILED;
        }
    };
    if let Err(e) = std::fs::write(&marker, payload) {
        log(&format!("[install] cannot write {}: {e}", marker.display()));
        return exit::INSTALL_FAILED;
    }

    log(&format!(
        "[install] installed version {PRIVILEGED_LAUNCHER_VERSION} and registered \"{}\"",
        task::task_name(&sid)
    ));
    exit::OK
}
