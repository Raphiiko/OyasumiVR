use log::info;
use oyasumivr_shared::task;
use oyasumivr_shared::windows::{
    allow_user_cleanup, current_user_sid, is_elevated, privileged_cleanup_dir, protect_directory,
    PrivilegedLauncherLock, PRIVILEGED_LAUNCHER_CLEANUP_EXE, PRIVILEGED_LAUNCHER_CLEANUP_TOKEN,
};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const LAUNCHER_EXE: &str = "oyasumivr-privileged-launcher.exe";
const LAUNCHER_MARKER: &str = "launcher.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupDisposition {
    RemoveInstallation { process_id: u32 },
    RetainInstallation,
}

pub fn remove_privileged_launcher() -> Result<CleanupDisposition, String> {
    require_elevation()?;
    let _lock = PrivilegedLauncherLock::acquire()
        .map_err(|e| format!("cannot lock the privileged launcher installation: {e}"))?;
    let sid = current_user_sid().map_err(|e| format!("cannot read the current user SID: {e}"))?;
    let dir = privileged_dir()?;
    let retain_installation = task::has_other_registration(&sid)
        .map_err(|e| format!("cannot inspect the scheduled tasks: {e}"))?;
    if retain_installation || !dir.exists() {
        task::unregister(&sid).map_err(|e| format!("cannot delete the scheduled task: {e}"))?;
        return Ok(CleanupDisposition::RetainInstallation);
    }

    let token = cleanup_token();
    let token_path = dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN);
    std::fs::write(&token_path, &token)
        .map_err(|e| format!("cannot prepare directory cleanup: {e}"))?;
    match spawn_cleanup_helper(std::process::id(), &token) {
        Ok(process_id) => Ok(CleanupDisposition::RemoveInstallation { process_id }),
        Err(e) => {
            let _ = std::fs::remove_file(token_path);
            Err(e)
        }
    }
}

pub fn run_cleanup_helper(parent_pid: u32, token: &str) -> Result<(), String> {
    require_elevation()?;
    wait_for_process(parent_pid)?;

    let sid = current_user_sid().map_err(|e| format!("cannot read the current user SID: {e}"))?;
    let helper_dir = privileged_cleanup_dir()
        .map_err(|e| format!("cannot resolve the cleanup helper directory: {e}"))?;
    let helper_exe = helper_dir.join(PRIVILEGED_LAUNCHER_CLEANUP_EXE);
    let result = remove_installation(&privileged_dir()?, token, &sid);
    let permissions = allow_user_cleanup(&helper_dir, &helper_exe, &sid)
        .map_err(|e| format!("cannot release the cleanup helper: {e}"));

    match (result, permissions) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(cleanup), Ok(())) => Err(cleanup),
        (Ok(()), Err(permissions)) => Err(permissions),
        (Err(cleanup), Err(permissions)) => Err(format!("{cleanup}; {permissions}")),
    }
}

fn require_elevation() -> Result<(), String> {
    if is_elevated() {
        Ok(())
    } else {
        Err("the cleanup process is not running with administrator access".to_string())
    }
}

fn privileged_dir() -> Result<PathBuf, String> {
    oyasumivr_shared::windows::program_files()
        .map_err(|e| format!("cannot resolve Program Files: {e}"))
        .map(|path| path.join("OyasumiVR").join("privileged"))
}

fn cleanup_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{}-{nanos}", std::process::id())
}

fn spawn_cleanup_helper(parent_pid: u32, token: &str) -> Result<u32, String> {
    use std::os::windows::fs::MetadataExt;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    let helper_dir = privileged_cleanup_dir()
        .map_err(|e| format!("cannot resolve the cleanup helper directory: {e}"))?;
    std::fs::create_dir_all(&helper_dir)
        .map_err(|e| format!("cannot create {}: {e}", helper_dir.display()))?;
    let attributes = std::fs::symlink_metadata(&helper_dir)
        .map_err(|e| format!("cannot inspect {}: {e}", helper_dir.display()))?
        .file_attributes();
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("the cleanup helper directory is a reparse point".to_string());
    }
    protect_directory(&helper_dir)
        .map_err(|e| format!("cannot secure {}: {e}", helper_dir.display()))?;

    let helper_exe = helper_dir.join(PRIVILEGED_LAUNCHER_CLEANUP_EXE);
    match std::fs::remove_file(&helper_exe) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("cannot replace {}: {e}", helper_exe.display())),
    }

    let current_exe =
        std::env::current_exe().map_err(|e| format!("cannot locate the elevated sidecar: {e}"))?;
    let mut source =
        File::open(current_exe).map_err(|e| format!("cannot open the elevated sidecar: {e}"))?;
    let mut target = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&helper_exe)
        .map_err(|e| format!("cannot create {}: {e}", helper_exe.display()))?;
    std::io::copy(&mut source, &mut target)
        .map_err(|e| format!("cannot copy the cleanup helper: {e}"))?;
    target
        .flush()
        .and_then(|_| target.sync_all())
        .map_err(|e| format!("cannot finish the cleanup helper: {e}"))?;
    drop(target);

    let child = Command::new(&helper_exe)
        .current_dir(&helper_dir)
        .args([
            format!("--cleanup-parent-pid={parent_pid}"),
            format!("--cleanup-token={token}"),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("cannot start the cleanup process: {e}"))?;
    Ok(child.id())
}

fn wait_for_process(process_id: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_INVALID_PARAMETER, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
    };

    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, process_id) };
    if handle.is_null() {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32) {
            return Ok(());
        }
        return Err(format!("cannot open parent process {process_id}: {error}"));
    }
    let wait = unsafe { WaitForSingleObject(handle, INFINITE) };
    unsafe { CloseHandle(handle) };
    if wait == WAIT_OBJECT_0 {
        Ok(())
    } else {
        Err(format!(
            "cannot wait for parent process {process_id}: {}",
            std::io::Error::last_os_error()
        ))
    }
}

fn remove_installation(dir: &Path, token: &str, user_sid: &str) -> Result<(), String> {
    let _lock = PrivilegedLauncherLock::acquire()
        .map_err(|e| format!("cannot lock the privileged launcher installation: {e}"))?;
    let token_path = dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN);
    let installed_token = match std::fs::read_to_string(&token_path) {
        Ok(token) => token,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("cannot read {}: {e}", token_path.display())),
    };
    if installed_token != token {
        info!("A newer privileged launcher installation cancelled cleanup");
        return Ok(());
    }

    let snapshot = InstallationSnapshot::read(dir)?;
    let task_exists =
        task::exists(user_sid).map_err(|e| format!("cannot inspect the scheduled task: {e}"))?;
    let task_enabled = task_exists
        && task::registration(user_sid)
            .map_err(|e| format!("cannot inspect the scheduled task: {e}"))?
            .enabled;
    if task_enabled {
        task::set_enabled(user_sid, false)
            .map_err(|e| format!("cannot disable the scheduled task: {e}"))?;
    }

    let cleanup = std::fs::remove_dir_all(dir)
        .map_err(|e| format!("cannot delete {}: {e}", dir.display()))
        .and_then(|_| {
            if task_exists {
                task::unregister(user_sid)
                    .map_err(|e| format!("cannot delete the scheduled task: {e}"))?;
            }
            Ok(())
        });
    if let Err(cleanup_error) = cleanup {
        let restore_error = snapshot.restore(dir).err();
        let task_error = if task_enabled {
            task::set_enabled(user_sid, true)
                .map_err(|e| format!("cannot re-enable the scheduled task: {e}"))
                .err()
        } else {
            None
        };
        let mut errors = vec![cleanup_error];
        errors.extend(restore_error);
        errors.extend(task_error);
        return Err(errors.join("; "));
    }
    Ok(())
}

struct InstallationSnapshot {
    launcher: Option<Vec<u8>>,
    marker: Option<Vec<u8>>,
}

impl InstallationSnapshot {
    fn read(dir: &Path) -> Result<Self, String> {
        Ok(Self {
            launcher: read_optional(&dir.join(LAUNCHER_EXE))?,
            marker: read_optional(&dir.join(LAUNCHER_MARKER))?,
        })
    }

    fn restore(&self, dir: &Path) -> Result<(), String> {
        std::fs::create_dir_all(dir.join("staged"))
            .map_err(|e| format!("cannot recreate {}: {e}", dir.display()))?;
        protect_directory(dir).map_err(|e| format!("cannot secure {}: {e}", dir.display()))?;
        protect_directory(&dir.join("staged"))
            .map_err(|e| format!("cannot secure the staged sidecar directory: {e}"))?;
        self.restore_files(dir)
    }

    fn restore_files(&self, dir: &Path) -> Result<(), String> {
        write_optional(&dir.join(LAUNCHER_EXE), self.launcher.as_deref())?;
        write_optional(&dir.join(LAUNCHER_MARKER), self.marker.as_deref())?;
        Ok(())
    }
}

fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

fn write_optional(path: &Path, bytes: Option<&[u8]>) -> Result<(), String> {
    if let Some(bytes) = bytes {
        std::fs::write(path, bytes)
            .map_err(|e| format!("cannot restore {}: {e}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_launcher_state(dir: &Path) {
        std::fs::write(dir.join(LAUNCHER_EXE), b"launcher").unwrap();
        std::fs::write(dir.join(LAUNCHER_MARKER), b"marker").unwrap();
    }

    #[test]
    fn snapshot_restores_launcher_files_after_a_partial_removal() {
        let dir = scratch("oyasumi-elevated-cleanup-restore");
        write_launcher_state(&dir);
        let snapshot = InstallationSnapshot::read(&dir).unwrap();
        std::fs::remove_file(dir.join(LAUNCHER_EXE)).unwrap();
        std::fs::remove_file(dir.join(LAUNCHER_MARKER)).unwrap();

        snapshot.restore_files(&dir).unwrap();

        assert_eq!(std::fs::read(dir.join(LAUNCHER_EXE)).unwrap(), b"launcher");
        assert_eq!(std::fs::read(dir.join(LAUNCHER_MARKER)).unwrap(), b"marker");
    }

    #[test]
    fn snapshot_accepts_an_incomplete_installation() {
        for missing in [LAUNCHER_EXE, LAUNCHER_MARKER] {
            let dir = scratch(&format!("oyasumi-elevated-cleanup-missing-{missing}"));
            write_launcher_state(&dir);
            std::fs::remove_file(dir.join(missing)).unwrap();

            let snapshot = InstallationSnapshot::read(&dir).unwrap();

            assert_eq!(snapshot.launcher.is_some(), missing != LAUNCHER_EXE);
            assert_eq!(snapshot.marker.is_some(), missing != LAUNCHER_MARKER);
        }
    }
}
