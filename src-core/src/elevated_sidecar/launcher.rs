//! Whether the privileged launcher is installed and healthy, how to install it, and how to start
//! it.
//!
//! The launcher is a small binary in `%ProgramFiles%\OyasumiVR\privileged\`, started by a
//! triggerless scheduled task with highest privileges. Registering that task needs admin once.
//! Starting it needs nothing.

use log::{error, info, warn};
use oyasumivr_shared::windows::{current_user_sid, is_elevated};
use oyasumivr_shared::{elevated_sidecar_key_id, task, PRIVILEGED_LAUNCHER_VERSION};
use serde::Deserialize;
use std::path::PathBuf;

pub const LAUNCHER_EXE: &str = "oyasumivr-privileged-launcher.exe";
pub const SIDECAR_EXE: &str = "oyasumivr-elevated-sidecar.exe";

/// Where the app ships the launcher and the sidecar, relative to the executable's directory.
pub const LAUNCHER_RESOURCE_DIR: &str = "resources/privileged-launcher";
pub const SIDECAR_RESOURCE_DIR: &str = "resources/elevated-sidecar";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum LauncherState {
    /// Not an administrator account, so no elevated token is available.
    NotSupported,
    NotInstalled,
    Outdated { installed: u32, expected: u32 },
    /// Installed by a build with a different signing key, so it would refuse this sidecar.
    KeyMismatch,
    /// The task exists but does not match what we registered.
    Untrusted { reason: String },
    Ready,
}

#[derive(Deserialize)]
struct Marker {
    version: u32,
    #[serde(default)]
    key: String,
}

pub fn privileged_dir() -> Option<PathBuf> {
    std::env::var("ProgramFiles")
        .ok()
        .map(|p| PathBuf::from(p).join("OyasumiVR").join("privileged"))
}

fn installed_launcher() -> Option<PathBuf> {
    privileged_dir().map(|p| p.join(LAUNCHER_EXE))
}

fn resource(dir: &str, file: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.parent()?.join(dir).join(file))
}

pub fn bundled_launcher() -> Option<PathBuf> {
    resource(LAUNCHER_RESOURCE_DIR, LAUNCHER_EXE)
}

pub fn bundled_sidecar() -> Option<PathBuf> {
    resource(SIDECAR_RESOURCE_DIR, SIDECAR_EXE)
}

/// Only an administrator account can use these features. Without an elevated token,
/// `RunLevel Highest` runs the sidecar unprivileged and every privileged call fails.
pub fn supported() -> bool {
    is_elevated() || can_elevate()
}

/// Whether this account can produce an elevated token at all.
///
/// Read from the token's elevation type, not from Administrators group membership, which reports
/// false on a split token because the SID is present but deny-only.
fn can_elevate() -> bool {
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevationType, TokenElevationTypeFull, TokenElevationTypeLimited,
        TOKEN_ELEVATION_TYPE, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = windows::Win32::Foundation::HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION_TYPE::default();
        let mut returned = 0u32;
        let read = GetTokenInformation(
            token,
            TokenElevationType,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION_TYPE>() as u32,
            &mut returned,
        )
        .is_ok();
        let _ = windows::Win32::Foundation::CloseHandle(token);
        if !read {
            return false;
        }
        // Default covers a standard user and an account with UAC off, which is already elevated
        elevation == TokenElevationTypeFull || elevation == TokenElevationTypeLimited
    }
}

pub fn state() -> LauncherState {
    if !supported() {
        return LauncherState::NotSupported;
    }
    let (Some(dir), Some(expected_exe)) = (privileged_dir(), installed_launcher()) else {
        return LauncherState::NotInstalled;
    };
    if !expected_exe.is_file() {
        return LauncherState::NotInstalled;
    }

    let marker = match std::fs::read(dir.join("launcher.json"))
        .ok()
        .and_then(|raw| serde_json::from_slice::<Marker>(&raw).ok())
    {
        Some(marker) => marker,
        None => return LauncherState::NotInstalled,
    };

    let sid = current_user_sid().unwrap_or_default();
    // read the task back: one whose action was rewritten still exists
    let registration = match task::registration(&sid) {
        Ok(registration) => registration,
        Err(e) => {
            info!("[Core] No usable privileged launcher task: {e}");
            return LauncherState::NotInstalled;
        }
    };
    let mismatch = if !paths_match(&registration.action_path, &expected_exe) {
        Some(format!("action points at {}", registration.action_path))
    } else if !registration.action_arguments.trim().is_empty() {
        Some(format!(
            "action carries arguments: {}",
            registration.action_arguments
        ))
    } else if !registration.run_level_is_highest {
        Some("run level is not highest".to_string())
    } else if !sid.is_empty() && !sddl_is_ours(&registration.sddl, &sid) {
        Some(format!("security descriptor is {}", registration.sddl))
    } else {
        None
    };
    if let Some(reason) = mismatch {
        warn!("[Core] Privileged launcher task is not trustworthy: {reason}");
        return LauncherState::Untrusted { reason };
    }
    // catch a key change here, where a reinstall can fix it, rather than at launch time
    if !marker.key.is_empty() && marker.key != elevated_sidecar_key_id() {
        warn!("[Core] The installed privileged launcher was built with a different signing key");
        return LauncherState::KeyMismatch;
    }

    // only older counts: a newer launcher runs an older sidecar, and reinstalling would prompt
    if marker.version < PRIVILEGED_LAUNCHER_VERSION {
        return LauncherState::Outdated {
            installed: marker.version,
            expected: PRIVILEGED_LAUNCHER_VERSION,
        };
    }
    LauncherState::Ready
}

fn paths_match(reported: &str, expected: &std::path::Path) -> bool {
    reported.trim().trim_matches('"').eq_ignore_ascii_case(
        expected
            .to_str()
            .unwrap_or_default(),
    )
}

/// Anything wider than read and execute for the user is a way to re-aim the task.
///
/// Every ACE has to be one we registered. An unrecognised trustee is rejected rather than ignored,
/// so an added entry such as `(A;;FA;;;WD)` cannot pass alongside the expected three.
fn sddl_is_ours(reported: &str, sid: &str) -> bool {
    let Some(dacl) = reported.replace(' ', "").split("D:").nth(1).map(str::to_string) else {
        return false;
    };
    let mut saw_system = false;
    let mut saw_administrators = false;
    let mut saw_user = false;

    for ace in dacl.split('(').skip(1) {
        let Some(ace) = ace.split(')').next() else {
            return false;
        };
        if ace.is_empty() {
            continue;
        }
        let fields: Vec<&str> = ace.split(';').collect();
        // type;flags;rights;object;inherit;trustee
        if fields.len() != 6 || fields[0] != "A" {
            return false;
        }
        let (rights, trustee) = (fields[2], fields[5]);
        match trustee {
            "SY" if rights == "FA" => saw_system = true,
            "BA" if rights == "FA" => saw_administrators = true,
            t if t == sid && (rights == "FRFX" || rights == "0x1200a9") => saw_user = true,
            _ => return false,
        }
    }
    saw_system && saw_administrators && saw_user
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallOutcome {
    Ok,
    PromptDeclined,
    Failed,
}

/// Runs the bundled launcher with `--install`, elevated. This is the one UAC prompt the user sees.
pub fn install() -> InstallOutcome {
    let Some(source) = bundled_launcher() else {
        error!("[Core] Cannot find the bundled privileged launcher");
        return InstallOutcome::Failed;
    };
    if !source.is_file() {
        error!(
            "[Core] The bundled privileged launcher is missing: {}",
            source.display()
        );
        return InstallOutcome::Failed;
    }
    match super::elevate::run_and_wait(&source, "--install") {
        Ok(0) => {
            info!("[Core] Installed the privileged launcher");
            InstallOutcome::Ok
        }
        Ok(code) => {
            error!("[Core] The privileged launcher installer exited with {code}");
            InstallOutcome::Failed
        }
        Err(super::elevate::ElevateError::Declined) => InstallOutcome::PromptDeclined,
        Err(e) => {
            error!("[Core] Could not run the privileged launcher installer: {e}");
            InstallOutcome::Failed
        }
    }
}

/// Starts the task. Needs no elevation and raises no prompt.
pub fn trigger() -> Result<(), String> {
    let sid = current_user_sid().map_err(|e| e.to_string())?;
    task::run(&sid).map_err(|e| e.to_string())
}

/// The launcher's exit code from its last run, its only channel back to the core.
pub fn last_launcher_result() -> Option<i32> {
    task::last_result(&current_user_sid().ok()?).ok()
}

pub fn describe_launcher_result(code: i32) -> &'static str {
    match code {
        0 => "ok",
        10 => "the launcher was started without elevation",
        11 => "the launcher could not install itself",
        12 => "the launcher could not register its task",
        20 => "the launcher found no usable handshake",
        21 => "the launcher refused the sidecar's signature",
        22 => "the launcher could not stage the sidecar",
        23 => "the launcher could not start the sidecar",
        _ => "unknown launcher failure",
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum EnableResult {
    Ok,
    /// The user dismissed the UAC prompt.
    PromptDeclined,
    InstallFailed,
    TaskFailed { reason: String },
    /// Not an administrator account, so these features stay unavailable.
    NotSupported,
}

/// Makes sure the launcher is installed and healthy, then starts the sidecar.
pub async fn enable() -> EnableResult {
    match state() {
        LauncherState::NotSupported => {
            // nothing to fall back to without an elevated token
            info!("[Core] Elevated features are unavailable on this account");
            return EnableResult::NotSupported;
        }
        LauncherState::Ready => {}
        LauncherState::NotInstalled
        | LauncherState::Outdated { .. }
        | LauncherState::KeyMismatch
        | LauncherState::Untrusted { .. } => {
            // install waits for the UAC prompt, which the user may leave on screen indefinitely
            match tokio::task::spawn_blocking(install).await {
                Ok(InstallOutcome::Ok) => {}
                Ok(InstallOutcome::PromptDeclined) => return EnableResult::PromptDeclined,
                Ok(InstallOutcome::Failed) => return EnableResult::InstallFailed,
                Err(e) => {
                    error!("[Core] The privileged launcher installer panicked: {e}");
                    return EnableResult::InstallFailed;
                }
            }
        }
    }

    // Anything short of Ready means nothing will run elevated, whatever the installer reported.
    match state() {
        LauncherState::Ready => {}
        LauncherState::Untrusted { reason } => return EnableResult::TaskFailed { reason },
        other => {
            return EnableResult::TaskFailed {
                reason: format!("the launcher is {other:?} after installing"),
            }
        }
    }
    if !super::commands::start_elevated_sidecar().await {
        return EnableResult::TaskFailed {
            reason: "the elevated sidecar could not be started".to_string(),
        };
    }
    EnableResult::Ok
}

#[cfg(test)]
mod tests {
    /// The answer depends on the account running the tests, so this only asserts the direction
    /// that must never be wrong: an elevated process must never be told it cannot elevate.
    const SID: &str = "S-1-5-21-1-2-3-1001";

    #[test]
    fn accepts_the_descriptor_we_register() {
        assert!(super::sddl_is_ours(
            &format!("D:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;{SID})"),
            SID
        ));
        assert!(super::sddl_is_ours(
            &format!("D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;{SID})"),
            SID
        ));
    }

    #[test]
    fn rejects_an_extra_ace_for_another_trustee() {
        assert!(!super::sddl_is_ours(
            &format!("D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;{SID})(A;;FA;;;WD)"),
            SID
        ));
    }

    #[test]
    fn rejects_write_access_for_the_user() {
        assert!(!super::sddl_is_ours(
            &format!("D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;{SID})"),
            SID
        ));
    }

    #[test]
    fn rejects_a_descriptor_missing_an_expected_ace() {
        assert!(!super::sddl_is_ours(&format!("D:(A;;FA;;;SY)(A;;0x1200a9;;;{SID})"), SID));
        assert!(!super::sddl_is_ours("", SID));
    }

    #[test]
    fn an_elevated_process_can_always_elevate() {
        if oyasumivr_shared::windows::is_elevated() {
            assert!(super::can_elevate(), "an elevated token must report Full");
        }
        assert!(!oyasumivr_shared::windows::is_elevated() || super::supported());
    }
}
