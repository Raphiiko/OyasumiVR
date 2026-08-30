//! Whether the privileged launcher is installed and healthy, how to install it, and how to start
//! it.
//!
//! The launcher is a small binary in `%ProgramFiles%\OyasumiVR\privileged\`, started by a
//! triggerless scheduled task with highest privileges. Registering that task needs admin once.
//! Starting it needs nothing.

use crate::utils::sidecar_manager::StartOutcome;
use log::{error, info, warn};
use oyasumivr_shared::windows::{current_user_sid, is_elevated};
use oyasumivr_shared::{elevated_sidecar_key_id, task, PRIVILEGED_LAUNCHER_VERSION};
use serde::Deserialize;
use std::path::PathBuf;
use std::time::Duration;

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
    Outdated {
        installed: u32,
        expected: u32,
    },
    /// Installed by a build with a different signing key, so it would refuse this sidecar.
    KeyMismatch,
    /// The task exists but does not match what we registered.
    Untrusted {
        reason: String,
    },
    Ready,
}

#[derive(Deserialize)]
struct Marker {
    version: u32,
    #[serde(default)]
    key: String,
}

pub fn privileged_dir() -> Option<PathBuf> {
    oyasumivr_shared::windows::program_files()
        .ok()
        .map(|p| p.join("OyasumiVR").join("privileged"))
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

    let sid = match current_user_sid() {
        Ok(sid) if !sid.is_empty() => sid,
        _ => {
            return LauncherState::Untrusted {
                reason: "cannot read this account's sid, so the task cannot be checked".to_string(),
            }
        }
    };
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
    } else if !sddl_is_ours(&registration.sddl, &sid) {
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
    reported
        .trim()
        .trim_matches('"')
        .eq_ignore_ascii_case(expected.to_str().unwrap_or_default())
}

/// Anything wider than read and execute for the user is a way to re-aim the task.
///
/// Every ACE has to be one we registered. An unrecognised trustee is rejected rather than ignored,
/// so an added entry such as `(A;;FA;;;WD)` cannot pass alongside the expected three. The DACL has
/// to be protected, and the owner has to be an administrator, because an owner can rewrite a DACL
/// whatever it says.
fn sddl_is_ours(reported: &str, sid: &str) -> bool {
    let reported = reported.replace(' ', "");
    let Some(dacl) = reported.split("D:").nth(1).map(str::to_string) else {
        return false;
    };
    let owner = reported
        .split("O:")
        .nth(1)
        .map(|rest| {
            rest.split(['G', 'D', 'S', '('])
                .next()
                .unwrap_or_default()
                .to_string()
        })
        .unwrap_or_default();
    if owner != "BA" && owner != "SY" {
        return false;
    }
    // the flags come before the first ACE, and Windows adds AI to what we registered
    let flags = dacl.split('(').next().unwrap_or_default();
    if !flags.contains('P') {
        return false;
    }
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
    // 0x00041301 and 0x00041303 come from the scheduler, not from the launcher.
    match code {
        0 => "ok",
        0x0004_1301 => "the launcher is still running",
        0x0004_1303 => "the launcher has never run",
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
    TaskFailed {
        reason: String,
    },
    /// Not an administrator account, so these features stay unavailable.
    NotSupported,
}

/// How long enable waits for the sidecar to report in. One second past the give-up timer, so a
/// sidecar the manager still accepts is not reported as a failure, and the launcher has exited and
/// written the exit code by the time it is read.
const START_TIMEOUT: Duration =
    Duration::from_secs(crate::utils::sidecar_manager::GIVE_UP_AFTER.as_secs() + 1);

/// Makes sure the launcher is installed and healthy, then starts the sidecar.
pub async fn enable() -> EnableResult {
    let _transition = super::TRANSITION.lock().await;
    // A build that elevates the sidecar directly has no launcher to install or check.
    let through_task = super::uses_scheduled_task().await;
    if through_task {
        if let Some(failure) = install_if_needed().await {
            return failure;
        }
    }

    match super::commands::start_sidecar().await {
        // AlreadyRunning included: a sidecar on its way is what the caller asked for.
        outcome if outcome.is_on_its_way() => {}
        StartOutcome::Declined => return EnableResult::PromptDeclined,
        _ => {
            return EnableResult::TaskFailed {
                reason: "the elevated sidecar could not be started".to_string(),
            }
        }
    }

    // Nothing so far says a sidecar exists. The task reports only that it was asked to start, and
    // a prompt being answered says nothing either, so wait for the sidecar itself.
    if !super::wait_until_started(START_TIMEOUT).await {
        let reason = match through_task {
            true => last_launcher_result()
                .map(describe_launcher_result)
                .unwrap_or("the launcher reported no result")
                .to_string(),
            false => "the elevated sidecar did not report in".to_string(),
        };
        error!("[Core] The elevated sidecar did not start: {reason}");
        return EnableResult::TaskFailed { reason };
    }
    EnableResult::Ok
}

/// `None` when the launcher is ready to start a sidecar.
async fn install_if_needed() -> Option<EnableResult> {
    // state reads files and talks to the Task Scheduler over COM, so it does not belong on a
    // runtime worker
    match tokio::task::spawn_blocking(state).await {
        Ok(LauncherState::NotSupported) => {
            // nothing to fall back to without an elevated token
            info!("[Core] Elevated features are unavailable on this account");
            return Some(EnableResult::NotSupported);
        }
        Ok(LauncherState::Ready) => return None,
        Ok(_) => {}
        Err(e) => {
            error!("[Core] Could not read the privileged launcher state: {e}");
            return Some(EnableResult::InstallFailed);
        }
    }

    // install waits for the UAC prompt, which the user may leave on screen indefinitely
    match tokio::task::spawn_blocking(install).await {
        Ok(InstallOutcome::Ok) => {}
        Ok(InstallOutcome::PromptDeclined) => return Some(EnableResult::PromptDeclined),
        Ok(InstallOutcome::Failed) => return Some(EnableResult::InstallFailed),
        Err(e) => {
            error!("[Core] The privileged launcher installer panicked: {e}");
            return Some(EnableResult::InstallFailed);
        }
    }

    // Anything short of Ready means nothing will run elevated, whatever the installer reported.
    match tokio::task::spawn_blocking(state).await {
        Ok(LauncherState::Ready) => None,
        Ok(LauncherState::Untrusted { reason }) => Some(EnableResult::TaskFailed { reason }),
        Ok(other) => Some(EnableResult::TaskFailed {
            reason: format!("the launcher is {other:?} after installing"),
        }),
        Err(e) => {
            error!("[Core] Could not read the privileged launcher state: {e}");
            Some(EnableResult::InstallFailed)
        }
    }
}

#[cfg(test)]
mod tests {
    const SID: &str = "S-1-5-21-1-2-3-1001";

    #[test]
    fn accepts_the_descriptor_we_register() {
        // exactly what Windows reported back on a real registration
        assert!(super::sddl_is_ours(
            &format!("O:BAD:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;{SID})"),
            SID
        ));
        assert!(super::sddl_is_ours(
            &format!("O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;{SID})"),
            SID
        ));
    }

    #[test]
    fn rejects_an_extra_ace_for_another_trustee() {
        assert!(!super::sddl_is_ours(
            &format!("O:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;{SID})(A;;FA;;;WD)"),
            SID
        ));
    }

    #[test]
    fn rejects_write_access_for_the_user() {
        assert!(!super::sddl_is_ours(
            &format!("O:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;{SID})"),
            SID
        ));
    }

    #[test]
    fn rejects_a_descriptor_missing_an_expected_ace() {
        assert!(!super::sddl_is_ours(
            &format!("O:BAD:P(A;;FA;;;SY)(A;;0x1200a9;;;{SID})"),
            SID
        ));
        assert!(!super::sddl_is_ours("", SID));
    }

    #[test]
    fn rejects_a_dacl_that_is_not_protected() {
        // without P the task inherits entries from the task folder
        assert!(!super::sddl_is_ours(
            &format!("O:BAD:AI(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;{SID})"),
            SID
        ));
    }

    #[test]
    fn rejects_an_owner_who_is_not_an_administrator() {
        // an owner can grant itself full control whatever the DACL says
        assert!(!super::sddl_is_ours(
            &format!("O:{SID}D:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;{SID})"),
            SID
        ));
        assert!(
            !super::sddl_is_ours(
                &format!("D:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;{SID})"),
                SID
            ),
            "a descriptor with no owner says nothing about who can rewrite it"
        );
    }

    #[test]
    fn paths_match_ignores_quoting_and_case() {
        let expected = std::path::Path::new(r"C:\Program Files\OyasumiVR\privileged\x.exe");
        assert!(super::paths_match(
            r"C:\Program Files\OyasumiVR\privileged\x.exe",
            expected
        ));
        assert!(super::paths_match(
            r#"  "C:\program files\oyasumivr\privileged\X.EXE"  "#,
            expected
        ));
        assert!(!super::paths_match(
            r"C:\Windows\System32\cmd.exe",
            expected
        ));
        assert!(!super::paths_match("", expected));
    }

    #[test]
    fn rejects_a_deny_ace_and_a_conditional_ace() {
        // Neither is an allow ACE with six fields, which is all this accepts.
        assert!(!super::sddl_is_ours(
            &format!("O:BAD:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;{SID})(D;;FA;;;WD)"),
            SID
        ));
        assert!(!super::sddl_is_ours(
            &format!(
                "O:BAD:PAI(XA;;FA;;;WD;(Member_of{{SID(BA)}}))(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;{SID})"
            ),
            SID
        ));
    }

    #[test]
    fn the_scheduler_results_are_not_reported_as_a_launcher_failure() {
        assert_eq!(super::describe_launcher_result(0), "ok");
        assert_eq!(
            super::describe_launcher_result(0x0004_1301),
            "the launcher is still running"
        );
        assert_eq!(
            super::describe_launcher_result(0x0004_1303),
            "the launcher has never run"
        );
        assert_eq!(
            super::describe_launcher_result(21),
            "the launcher refused the sidecar\'s signature"
        );
    }

    #[test]
    fn the_wait_outlasts_the_give_up_timer() {
        // The manager accepts a sidecar until the give-up timer fires, so the wait has to outlast it.
        assert!(super::START_TIMEOUT > crate::utils::sidecar_manager::GIVE_UP_AFTER);
    }

    /// The answer depends on the account running the tests, so this only asserts the direction
    /// that must never be wrong: an elevated process must never be told it cannot elevate.
    #[test]
    fn an_elevated_process_can_always_elevate() {
        if oyasumivr_shared::windows::is_elevated() {
            assert!(super::can_elevate(), "an elevated token must report Full");
        }
        assert!(!oyasumivr_shared::windows::is_elevated() || super::supported());
    }
}
