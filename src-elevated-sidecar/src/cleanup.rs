use oyasumivr_shared::task;
use oyasumivr_shared::windows::{
    current_user_sid, is_elevated, PrivilegedLauncherLock, PRIVILEGED_LAUNCHER_CLEANUP_TOKEN,
    PRIVILEGED_LAUNCHER_MUTEX,
};
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const LAUNCHER_EXE: &str = "oyasumivr-privileged-launcher.exe";
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupDisposition {
    RemoveInstallation,
    RetainInstallation,
}

pub fn remove_privileged_launcher() -> Result<CleanupDisposition, String> {
    if !is_elevated() {
        return Err("the elevated sidecar is not running with administrator access".to_string());
    }
    let _lock = PrivilegedLauncherLock::acquire()
        .map_err(|e| format!("cannot lock the privileged launcher installation: {e}"))?;
    let sid = current_user_sid().map_err(|e| format!("cannot read the current user SID: {e}"))?;
    let dir = oyasumivr_shared::windows::program_files()
        .map_err(|e| format!("cannot resolve Program Files: {e}"))?
        .join("OyasumiVR")
        .join("privileged");
    let retain_installation = task::has_other_registration(&sid)
        .map_err(|e| format!("cannot inspect the scheduled tasks: {e}"))?;
    task::unregister(&sid).map_err(|e| format!("cannot delete the scheduled task: {e}"))?;
    if retain_installation || !dir.exists() {
        return Ok(CleanupDisposition::RetainInstallation);
    }
    let token = cleanup_token();
    let token_path = dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN);
    let cleanup = std::fs::write(&token_path, &token)
        .map_err(|e| format!("cannot prepare directory cleanup: {e}"))
        .and_then(|_| spawn_directory_removal(&dir, &token));
    if let Err(e) = cleanup {
        let _ = std::fs::remove_file(&token_path);
        let launcher = dir.join(LAUNCHER_EXE);
        let staged = dir.join("staged");
        if let Err(restore_error) = task::register(&launcher, &staged, &sid) {
            return Err(format!(
                "{e}; cannot restore the scheduled task: {restore_error}"
            ));
        }
        return Err(e);
    }
    Ok(CleanupDisposition::RemoveInstallation)
}

fn cleanup_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{}-{nanos}", std::process::id())
}

fn spawn_directory_removal(dir: &Path, token: &str) -> Result<(), String> {
    spawn_directory_removal_after(std::process::id(), dir, token)
}

fn spawn_directory_removal_after(pid: u32, dir: &Path, token: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    let system = system_directory()?;
    let powershell = system.join("WindowsPowerShell/v1.0/powershell.exe");
    if !powershell.is_file() {
        return Err(format!("cannot find {}", powershell.display()));
    }
    let script = removal_script(pid, dir, token);
    Command::new(&powershell)
        .current_dir(system)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot start the cleanup process: {e}"))
}

fn system_directory() -> Result<std::path::PathBuf, String> {
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;

    let mut buffer = vec![0u16; 261];
    let mut length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
    if length == 0 {
        return Err("Windows did not return its system directory".to_string());
    }
    if length as usize >= buffer.len() {
        buffer.resize(length as usize + 1, 0);
        length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
        if length == 0 || length as usize >= buffer.len() {
            return Err("Windows returned an invalid system directory".to_string());
        }
    }
    Ok(std::path::PathBuf::from(String::from_utf16_lossy(
        &buffer[..length as usize],
    )))
}

fn removal_script(pid: u32, dir: &Path, token: &str) -> String {
    let literal = dir.display().to_string().replace('\'', "''");
    let token = token.replace('\'', "''");
    let mutex = PRIVILEGED_LAUNCHER_MUTEX.replace('\'', "''");
    format!(
        "$process = Get-Process -Id {pid} -ErrorAction SilentlyContinue; if ($process) {{ $process.WaitForExit() }}; $mutex = [Threading.Mutex]::new($false, '{mutex}'); try {{ if (-not $mutex.WaitOne(30000)) {{ exit 1 }}; $tokenPath = Join-Path '{literal}' '{PRIVILEGED_LAUNCHER_CLEANUP_TOKEN}'; if ((Get-Content -LiteralPath $tokenPath -Raw -ErrorAction SilentlyContinue) -eq '{token}') {{ $tombstone = '{literal}.cleanup-{token}'; Move-Item -LiteralPath '{literal}' -Destination $tombstone; Remove-Item -LiteralPath $tombstone -Recurse -Force }} }} finally {{ try {{ $mutex.ReleaseMutex() }} catch {{}}; $mutex.Dispose() }}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn powershell_receives_a_literal_cleanup_path() {
        let script = removal_script(
            42,
            Path::new(r"C:\Program Files\O'Brien\privileged"),
            "token",
        );
        assert!(script.contains("Get-Process -Id 42"));
        assert!(script.contains("-LiteralPath 'C:\\Program Files\\O''Brien\\privileged'"));
        assert!(script.contains(PRIVILEGED_LAUNCHER_MUTEX));
    }

    #[test]
    fn system_cleanup_process_removes_a_directory() {
        let dir = scratch("oyasumi-elevated-cleanup-process");
        std::fs::write(dir.join("artifact"), b"x").unwrap();
        std::fs::write(dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN), b"remove-me").unwrap();

        spawn_directory_removal_after(2_000_000_000, &dir, "remove-me").unwrap();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while dir.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(
            !dir.exists(),
            "the cleanup process did not remove the directory"
        );
    }

    #[test]
    fn cleanup_helper_leaves_a_reinstalled_directory() {
        let dir = scratch("oyasumi-elevated-cleanup-reinstalled");
        std::fs::write(dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN), b"new-install").unwrap();

        spawn_directory_removal_after(2_000_000_000, &dir, "old-install").unwrap();

        std::thread::sleep(std::time::Duration::from_secs(1));
        assert!(dir.exists());
    }

    #[test]
    fn system_cleanup_process_escapes_the_sidecar_directory() {
        const CHILD_DIR: &str = "OYASUMIVR_CLEANUP_TEST_CHILD_DIR";
        if let Some(dir) = std::env::var_os(CHILD_DIR) {
            spawn_directory_removal_after(2_000_000_000, Path::new(&dir), "child").unwrap();
            return;
        }

        let dir = scratch("oyasumi-elevated-cleanup-working-directory");
        let staged = dir.join("staged");
        std::fs::create_dir_all(&staged).unwrap();
        std::fs::write(staged.join("artifact"), b"x").unwrap();
        std::fs::write(dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN), b"child").unwrap();
        let status = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "cleanup::tests::system_cleanup_process_escapes_the_sidecar_directory",
            ])
            .env(CHILD_DIR, &dir)
            .current_dir(&staged)
            .status()
            .unwrap();
        assert!(status.success());

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while dir.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(!dir.exists(), "cleanup inherited the sidecar directory");
    }
}
