use oyasumivr_shared::task;
use oyasumivr_shared::windows::{
    current_user_sid, is_elevated, PrivilegedLauncherLock, PRIVILEGED_LAUNCHER_CLEANUP_TOKEN,
    PRIVILEGED_LAUNCHER_MUTEX,
};
use std::path::Path;
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
    if retain_installation || !dir.exists() {
        task::unregister(&sid).map_err(|e| format!("cannot delete the scheduled task: {e}"))?;
        return Ok(CleanupDisposition::RetainInstallation);
    }
    let token = cleanup_token();
    let token_path = dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN);
    let cleanup = std::fs::write(&token_path, &token)
        .map_err(|e| format!("cannot prepare directory cleanup: {e}"))
        .and_then(|_| spawn_directory_removal(&dir, &token, &sid));
    let process_id = match cleanup {
        Ok(process_id) => process_id,
        Err(e) => {
            let _ = std::fs::remove_file(&token_path);
            return Err(e);
        }
    };
    Ok(CleanupDisposition::RemoveInstallation { process_id })
}

fn cleanup_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{}-{nanos}", std::process::id())
}

fn spawn_directory_removal(dir: &Path, token: &str, user_sid: &str) -> Result<u32, String> {
    spawn_directory_removal_after(std::process::id(), dir, token, user_sid).map(|child| child.id())
}

fn spawn_directory_removal_after(
    pid: u32,
    dir: &Path,
    token: &str,
    user_sid: &str,
) -> Result<std::process::Child, String> {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    let system = system_directory()?;
    let powershell = system.join("WindowsPowerShell/v1.0/powershell.exe");
    if !powershell.is_file() {
        return Err(format!("cannot find {}", powershell.display()));
    }
    let script = removal_script(pid, dir, token, user_sid);
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

fn removal_script(pid: u32, dir: &Path, token: &str, user_sid: &str) -> String {
    let literal = dir.display().to_string().replace('\'', "''");
    let token = token.replace('\'', "''");
    let mutex = PRIVILEGED_LAUNCHER_MUTEX.replace('\'', "''");
    let task_name = task::task_name(user_sid).replace('\'', "''");
    format!(
        "$process = Get-Process -Id {pid} -ErrorAction SilentlyContinue; if ($process) {{ $process.WaitForExit() }}; $mutex = $null; $acquired = $false; $prepared = $false; $taskDisabled = $false; $task = $null; try {{ $mutex = [Threading.Mutex]::new($false, '{mutex}'); if (-not $mutex.WaitOne(30000)) {{ exit 1 }}; $acquired = $true; $tokenPath = Join-Path '{literal}' '{PRIVILEGED_LAUNCHER_CLEANUP_TOKEN}'; if ((Get-Content -LiteralPath $tokenPath -Raw -ErrorAction SilentlyContinue) -ne '{token}') {{ exit 0 }}; $launcherPath = Join-Path '{literal}' '{LAUNCHER_EXE}'; $markerPath = Join-Path '{literal}' '{LAUNCHER_MARKER}'; $directoryAcl = Get-Acl -LiteralPath '{literal}' -ErrorAction Stop; $launcherBytes = if (Test-Path -LiteralPath $launcherPath) {{ [IO.File]::ReadAllBytes($launcherPath) }} else {{ $null }}; $markerBytes = if (Test-Path -LiteralPath $markerPath) {{ [IO.File]::ReadAllBytes($markerPath) }} else {{ $null }}; $prepared = $true; $task = Get-ScheduledTask -TaskName '{task_name}' -ErrorAction SilentlyContinue; if ($task) {{ $task | Disable-ScheduledTask -ErrorAction Stop | Out-Null; $taskDisabled = $true }}; Remove-Item -LiteralPath '{literal}' -Recurse -Force -ErrorAction Stop; if ($task) {{ $task | Unregister-ScheduledTask -Confirm:$false -ErrorAction Stop }}; exit 0 }} catch {{ try {{ if ($prepared) {{ if (-not (Test-Path -LiteralPath '{literal}')) {{ [IO.DirectoryInfo]::new('{literal}').Create($directoryAcl) }}; $stagedPath = Join-Path '{literal}' 'staged'; if (-not (Test-Path -LiteralPath $stagedPath)) {{ [IO.DirectoryInfo]::new($stagedPath).Create($directoryAcl) }}; if (($null -ne $launcherBytes) -and -not (Test-Path -LiteralPath $launcherPath)) {{ [IO.File]::WriteAllBytes($launcherPath, $launcherBytes) }}; if (($null -ne $markerBytes) -and -not (Test-Path -LiteralPath $markerPath)) {{ [IO.File]::WriteAllBytes($markerPath, $markerBytes) }} }} }} catch {{}}; try {{ if ($taskDisabled) {{ $task | Enable-ScheduledTask -ErrorAction Stop | Out-Null }} }} catch {{}}; exit 1 }} finally {{ if ($acquired) {{ try {{ $mutex.ReleaseMutex() }} catch {{}} }}; if ($mutex) {{ $mutex.Dispose() }} }}"
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

    fn write_launcher_state(dir: &Path) {
        std::fs::write(dir.join(LAUNCHER_EXE), b"launcher").unwrap();
        std::fs::write(dir.join(LAUNCHER_MARKER), b"marker").unwrap();
    }

    #[test]
    fn powershell_receives_a_literal_cleanup_path() {
        let script = removal_script(
            42,
            Path::new(r"C:\Program Files\O'Brien\privileged"),
            "token",
            "S-1-5-21-1-2-3-1001",
        );
        assert!(script.contains("Get-Process -Id 42"));
        assert!(script.contains("-LiteralPath 'C:\\Program Files\\O''Brien\\privileged'"));
        assert!(script.contains(PRIVILEGED_LAUNCHER_MUTEX));
        assert!(script.contains("OyasumiVR Privileged Launcher (S-1-5-21-1-2-3-1001)"));
    }

    #[test]
    fn system_cleanup_process_removes_a_directory() {
        let dir = scratch("oyasumi-elevated-cleanup-process");
        write_launcher_state(&dir);
        std::fs::write(dir.join("artifact"), b"x").unwrap();
        std::fs::write(dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN), b"remove-me").unwrap();

        let status =
            spawn_directory_removal_after(2_000_000_000, &dir, "remove-me", "S-1-5-21-1-2-3-1001")
                .unwrap()
                .wait()
                .unwrap();

        assert!(status.success());
        assert!(
            !dir.exists(),
            "the cleanup process did not remove the directory"
        );
    }

    #[test]
    fn cleanup_helper_leaves_a_reinstalled_directory() {
        let dir = scratch("oyasumi-elevated-cleanup-reinstalled");
        std::fs::write(dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN), b"new-install").unwrap();

        let status = spawn_directory_removal_after(
            2_000_000_000,
            &dir,
            "old-install",
            "S-1-5-21-1-2-3-1001",
        )
        .unwrap()
        .wait()
        .unwrap();

        assert!(status.success());
        assert!(dir.exists());
    }

    #[test]
    fn cleanup_helper_reports_a_removal_failure_without_renaming_the_directory() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};

        let dir = scratch("oyasumi-elevated-cleanup-failure");
        write_launcher_state(&dir);
        let launcher = dir.join(LAUNCHER_EXE);
        std::fs::write(dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN), b"remove-me").unwrap();
        let locked = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(&launcher)
            .unwrap();

        let status =
            spawn_directory_removal_after(2_000_000_000, &dir, "remove-me", "S-1-5-21-1-2-3-1001")
                .unwrap()
                .wait()
                .unwrap();

        assert!(!status.success());
        assert!(dir.exists());
        assert_eq!(std::fs::read(dir.join(LAUNCHER_EXE)).unwrap(), b"launcher");
        assert!(dir.join(LAUNCHER_MARKER).is_file());

        drop(locked);
        std::fs::write(dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN), b"retry").unwrap();
        let retry =
            spawn_directory_removal_after(2_000_000_000, &dir, "retry", "S-1-5-21-1-2-3-1001")
                .unwrap()
                .wait()
                .unwrap();

        assert!(retry.success());
        assert!(!dir.exists());
    }

    #[test]
    fn cleanup_helper_removes_an_incomplete_launcher_installation() {
        for missing in [LAUNCHER_EXE, LAUNCHER_MARKER] {
            let dir = scratch(&format!("oyasumi-elevated-cleanup-missing-{missing}"));
            write_launcher_state(&dir);
            std::fs::remove_file(dir.join(missing)).unwrap();
            std::fs::write(dir.join(PRIVILEGED_LAUNCHER_CLEANUP_TOKEN), b"remove-me").unwrap();

            let status = spawn_directory_removal_after(
                2_000_000_000,
                &dir,
                "remove-me",
                "S-1-5-21-1-2-3-1001",
            )
            .unwrap()
            .wait()
            .unwrap();

            assert!(status.success(), "cleanup failed with missing {missing}");
            assert!(!dir.exists());
        }
    }

    #[test]
    fn system_cleanup_process_escapes_the_sidecar_directory() {
        const CHILD_DIR: &str = "OYASUMIVR_CLEANUP_TEST_CHILD_DIR";
        if let Some(dir) = std::env::var_os(CHILD_DIR) {
            let child = spawn_directory_removal_after(
                2_000_000_000,
                Path::new(&dir),
                "child",
                "S-1-5-21-1-2-3-1001",
            )
            .unwrap();
            std::mem::forget(child);
            return;
        }

        let dir = scratch("oyasumi-elevated-cleanup-working-directory");
        let staged = dir.join("staged");
        write_launcher_state(&dir);
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
